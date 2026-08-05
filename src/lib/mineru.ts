/**
 * MinerU 标准 API 客户端（PDF → markdown 解析）。
 *
 * 仅依赖 fetch + token，便于单元测试。zip 处理在 mineru-zip.ts 中完成。
 * 文档：https://mineru.net/api/v4
 */

const MINERU_BASE = "https://mineru.net/api/v4";
const MINERU_MODEL_VERSION = "pipeline"; // 备选 "vlm"

export type MineruState =
  | "uploading"
  | "pending"
  | "running"
  | "done"
  | "failed";

/**
 * 把 MinerU 返回的原始 state 归一化为本项目使用的状态。
 * 原始取值：waiting-file | pending | running | converting | done | failed
 */
export function normalizeMineruState(raw: string): MineruState {
  switch (raw) {
    case "waiting-file":
      return "uploading";
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "converting":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

interface CreateBatchResponse {
  code: number;
  msg?: string;
  data?: {
    batch_id: string;
    file_urls: string[];
  };
}

/**
 * 申请上传地址并创建解析批次。
 * 返回 batchId 与用于直传 PDF 的 uploadUrl。
 */
export async function createBatch(
  token: string,
  input: { filename: string; size: number },
): Promise<{ batchId: string; uploadUrl: string }> {
  const resp = await fetch(`${MINERU_BASE}/file-urls/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      enable_formula: true,
      enable_table: true,
      model_version: MINERU_MODEL_VERSION,
      files: [{ name: input.filename, is_ocr: false }],
    }),
  });

  const json = (await resp.json()) as CreateBatchResponse;

  if (json.code !== 0 || !json.data) {
    throw new Error(
      json.msg || `MinerU createBatch failed (code ${json.code})`,
    );
  }

  const uploadUrl = json.data.file_urls?.[0];
  if (!uploadUrl) {
    throw new Error("MinerU createBatch returned no upload url");
  }

  return { batchId: json.data.batch_id, uploadUrl };
}

export interface MineruResult {
  state: MineruState;
  fullZipUrl?: string;
  fileName?: string;
  errMsg?: string;
  totalPages?: number;
}

interface BatchResultResponse {
  code: number;
  msg?: string;
  data?: {
    batch_id: string;
    extract_result?: {
      file_name?: string;
      state: string;
      err_msg?: string;
      full_zip_url?: string;
      extract_progress?: {
        extracted_pages: number;
        total_pages: number;
      };
    }[];
  };
}

/**
 * 查询批次解析状态。done 时直接返回 full_zip_url。
 */
export async function getBatchResult(
  token: string,
  batchId: string,
): Promise<MineruResult> {
  const resp = await fetch(`${MINERU_BASE}/extract-results/batch/${batchId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const json = (await resp.json()) as BatchResultResponse;

  if (json.code !== 0) {
    throw new Error(
      json.msg || `MinerU getBatchResult failed (code ${json.code})`,
    );
  }

  const first = json.data?.extract_result?.[0];
  if (!first) {
    return { state: "pending" };
  }

  return {
    state: normalizeMineruState(first.state),
    fullZipUrl: first.full_zip_url,
    fileName: first.file_name,
    errMsg: first.err_msg,
    totalPages: first.extract_progress?.total_pages,
  };
}

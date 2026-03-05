export interface R2Env {
  PAPERS_BUCKET: R2Bucket;
}

/**
 * 获取文件的公开访问 URL
 *
 * 注意：需要在 Cloudflare 控制台配置 R2 的公开访问域名
 *
 * @param bucket R2 bucket 实例
 * @param key 文件存储路径
 * @param expiresIn 过期时间（秒），暂未使用
 * @returns 文件访问 URL，如果未配置域名则返回 null
 */
export async function getFileUrl(
  bucket: R2Bucket,
  key: string,
  _expiresIn = 3600,
): Promise<string | null> {
  const object = await bucket.get(key);
  if (!object) {
    throw new Error(`File not found: ${key}`);
  }

  // TODO: 从环境变量读取 R2 公开域名
  // 例如：process.env.R2_PUBLIC_DOMAIN
  const publicDomain = process.env.R2_PUBLIC_DOMAIN;

  if (!publicDomain) {
    console.warn("R2_PUBLIC_DOMAIN not configured, returning null");
    return null;
  }

  return `https://${publicDomain}/${key}`;
}

/**
 * 删除 R2 中的文件
 *
 * @param bucket R2 bucket 实例
 * @param key 文件存储路径
 */
export async function deleteFile(bucket: R2Bucket, key: string): Promise<void> {
  try {
    await bucket.delete(key);
    console.log(`Successfully deleted file: ${key}`);
  } catch (error) {
    console.error(`Failed to delete file ${key}:`, error);
    throw new Error(`Failed to delete file: ${key}`);
  }
}

/**
 * 上传文件到 R2
 *
 * @param bucket R2 bucket 实例
 * @param key 文件存储路径
 * @param data 文件数据
 * @param contentType 文件 MIME 类型
 */
export async function uploadFile(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | ReadableStream<Uint8Array> | Blob,
  contentType?: string,
): Promise<void> {
  try {
    await bucket.put(key, data, {
      httpMetadata: contentType ? { contentType } : undefined,
    });
    console.log(`Successfully uploaded file: ${key}`);
  } catch (error) {
    console.error(`Failed to upload file ${key}:`, error);
    throw new Error(`Failed to upload file: ${key}`);
  }
}

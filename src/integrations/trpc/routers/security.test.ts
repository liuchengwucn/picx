import type { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { papers } from "#/db/schema";
import { paperRouter } from "./paper";
import { uploadRouter } from "./upload";

function createSelectChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
}

function createDbMock(selectResults: unknown[][] = []) {
  const select = vi.fn();

  for (const result of selectResults) {
    select.mockImplementationOnce(() => createSelectChain(result));
  }

  select.mockImplementation(() => createSelectChain([]));

  const insert = vi.fn((table) => ({
    values: vi.fn().mockReturnValue({
      returning: vi
        .fn()
        .mockResolvedValue(
          table === papers ? [{ id: "paper-1", status: "pending" }] : [],
        ),
    }),
  }));

  const update = vi.fn(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "user-1", credits: 9 }]),
      }),
    }),
  }));

  return {
    select,
    insert,
    update,
  };
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: { id: "user-1" },
        }),
      },
    },
    headers: new Headers(),
    env: {
      PAPER_QUEUE: {
        send: vi.fn().mockResolvedValue(undefined),
      },
      PAPERS_BUCKET: {
        put: vi.fn().mockResolvedValue(undefined),
      },
    },
    db: createDbMock(),
    ...overrides,
  };
}

describe("paperRouter.create security checks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an api config that does not belong to the caller", async () => {
    const ctx = createContext({
      db: createDbMock([[]]),
    });

    const caller = paperRouter.createCaller(ctx as never);

    await expect(
      caller.create({
        sourceType: "upload",
        filename: "paper.pdf",
        fileSize: 8,
        r2Key: "papers/user-1/paper.pdf",
        apiConfigId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: "NOT_FOUND",
      message: "API configuration not found",
    });
  });

  it("rejects a prompt template that does not belong to the caller", async () => {
    const ctx = createContext({
      db: createDbMock([[{ id: "cfg-1" }], []]),
    });

    const caller = paperRouter.createCaller(ctx as never);

    await expect(
      caller.create({
        sourceType: "upload",
        filename: "paper.pdf",
        fileSize: 8,
        r2Key: "papers/user-1/paper.pdf",
        apiConfigId: "11111111-1111-4111-8111-111111111111",
        promptId: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: "NOT_FOUND",
      message: "Prompt template not found",
    });
  });
});

describe("uploadRouter.uploadFile validation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects uploads whose declared size does not match the decoded bytes", async () => {
    const caller = uploadRouter.createCaller(createContext() as never);
    const fileData = Buffer.from("%PDF-1.7\ncontent").toString("base64");

    await expect(
      caller.uploadFile({
        filename: "paper.pdf",
        fileData,
        fileSize: 1,
      }),
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: "BAD_REQUEST",
      message: "Declared file size does not match uploaded data",
    });
  });

  it("rejects uploads that are not PDFs", async () => {
    const caller = uploadRouter.createCaller(createContext() as never);
    const fileData = Buffer.from("plain text").toString("base64");

    await expect(
      caller.uploadFile({
        filename: "paper.pdf",
        fileData,
        fileSize: 10,
      }),
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: "BAD_REQUEST",
      message: "Uploaded file is not a valid PDF",
    });
  });
});

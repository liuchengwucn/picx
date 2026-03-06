export interface R2Env {
  PAPERS_BUCKET: R2Bucket;
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

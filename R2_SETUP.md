# R2 预签名 URL 配置指南

## 概述

本项目使用 Cloudflare R2 存储 PDF 文件，并通过 S3 兼容 API 生成预签名 URL，允许客户端直接上传文件到 R2。

## 前置要求

1. Cloudflare 账户
2. 已创建 R2 bucket（名称：`picx-papers`）
3. R2 API 访问密钥

## 获取 R2 访问密钥

1. 登录 Cloudflare Dashboard
2. 进入 R2 页面
3. 点击 "Manage R2 API Tokens"
4. 创建新的 API Token：
   - 权限：Object Read & Write
   - 选择 bucket：`picx-papers`
5. 保存生成的 Access Key ID 和 Secret Access Key

## 本地开发配置

1. 复制示例文件：
   ```bash
   cp .dev.vars.example .dev.vars
   ```

2. 编辑 `.dev.vars` 文件，填入实际值：
   ```
   R2_ACCOUNT_ID=your-r2-account-id
   R2_ACCESS_KEY_ID=your-r2-access-key-id
   R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
   ```

3. 获取 Account ID：
   - 在 Cloudflare Dashboard 右侧可以找到
   - 或者在 R2 页面 URL 中：`https://dash.cloudflare.com/<account-id>/r2`

## 生产环境配置

使用 Wrangler CLI 设置 secrets：

```bash
# 设置 Account ID（使用 vars）
wrangler secret put R2_ACCOUNT_ID

# 设置 Access Key ID
wrangler secret put R2_ACCESS_KEY_ID

# 设置 Secret Access Key
wrangler secret put R2_SECRET_ACCESS_KEY
```

## 使用方式

### 客户端上传流程

1. 调用 tRPC mutation 获取预签名 URL：
   ```typescript
   const { uploadUrl, r2Key, expiresIn } = await trpc.upload.getPresignedUrl.mutate({
     filename: 'document.pdf',
     contentType: 'application/pdf',
     fileSize: file.size
   });
   ```

2. 使用 PUT 请求上传文件到预签名 URL：
   ```typescript
   await fetch(uploadUrl, {
     method: 'PUT',
     body: file,
     headers: {
       'Content-Type': 'application/pdf'
     }
   });
   ```

3. 上传成功后，使用 `r2Key` 保存到数据库

## 安全注意事项

1. **不要提交 `.dev.vars` 文件到 git**（已在 `.gitignore` 中配置）
2. **使用最小权限原则**：API Token 只授予必要的权限
3. **定期轮换密钥**：建议每 90 天更换一次 API Token
4. **预签名 URL 有效期**：默认 1 小时，可根据需要调整

## 故障排查

### 错误：R2 credentials not configured

- 检查环境变量是否正确设置
- 本地开发：确认 `.dev.vars` 文件存在且格式正确
- 生产环境：确认已使用 `wrangler secret put` 设置所有密钥

### 错误：Failed to generate upload URL

- 检查 Account ID 是否正确
- 检查 API Token 权限是否足够
- 检查 bucket 名称是否正确（`picx-papers`）
- 查看 Worker 日志获取详细错误信息

## 技术细节

- 使用 `@aws-sdk/client-s3` 和 `@aws-sdk/s3-request-presigner` 生成预签名 URL
- R2 S3 兼容端点：`https://<account-id>.r2.cloudflarestorage.com`
- 支持的文件类型：PDF（`application/pdf`）
- 最大文件大小：50MB
- 预签名 URL 有效期：3600 秒（1 小时）

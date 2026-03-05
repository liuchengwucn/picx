# 配置文件说明

## 📁 配置文件结构

```
picx/
├── wrangler.jsonc          # Cloudflare Workers 配置（D1/R2/Queues/DO）
├── .dev.vars               # Wrangler 运行时密钥（不提交）
├── .dev.vars.example       # .dev.vars 模板
├── .env.local              # 构建时环境变量（不提交）
└── .env.example            # .env.local 模板
```

## 🎯 配置文件职责

### 1️⃣ `wrangler.jsonc`
**用途**：Cloudflare Workers 的所有配置
- D1 数据库绑定
- R2 存储桶绑定
- Queues 生产者/消费者
- Durable Objects 绑定和迁移
- 本地开发端口配置

**提交到 Git**：✅ 是

---

### 2️⃣ `.dev.vars`
**用途**：Wrangler 本地开发时的密钥（Worker 运行时变量）

**包含内容**：
- R2 访问密钥（用于预签名 URL）
- Better Auth Secret
- OAuth 客户端密钥
- AI API Keys

**访问方式**：在 Worker 中通过 `env.VARIABLE_NAME` 访问

**提交到 Git**：❌ 否（已在 .gitignore）

**生产环境**：使用 `wrangler secret put` 命令设置

---

### 3️⃣ `.env.local`
**用途**：构建时环境变量（Vite、Drizzle Kit、Node.js 脚本）

**包含内容**：
- Cloudflare 账户信息（用于 Drizzle Kit 远程操作）
- Better Auth URL
- AI API 配置（Base URL、Model）
- R2 公共域名

**访问方式**：在构建脚本中通过 `process.env.VARIABLE_NAME` 访问

**提交到 Git**：❌ 否（已在 .gitignore）

---

## 🚀 本地开发设置

### 首次设置

1. **复制配置文件**
```bash
cp .dev.vars.example .dev.vars
cp .env.example .env.local
```

2. **填写 `.dev.vars`**（Worker 运行时密钥）
```bash
# 编辑 .dev.vars，填入实际的密钥
```

3. **填写 `.env.local`**（构建时变量）
```bash
# 编辑 .env.local，填入 Cloudflare 账户信息
```

4. **创建 Cloudflare 资源**
```bash
# 创建 D1 数据库
wrangler d1 create picx-db
# 复制返回的 database_id 到 wrangler.jsonc

# 创建 R2 存储桶
wrangler r2 bucket create picx-papers
wrangler r2 bucket create picx-papers-preview

# 创建 Queues
wrangler queues create paper-processing
wrangler queues create paper-processing-dlq
```

5. **运行数据库迁移**
```bash
# 本地迁移
wrangler d1 migrations apply picx-db --local

# 生产迁移
wrangler d1 migrations apply picx-db --remote
```

6. **启动开发服务器**
```bash
npm run dev
```

---

## 🔐 生产环境配置

### 设置生产密钥

```bash
# R2 配置
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY

# Better Auth
wrangler secret put BETTER_AUTH_SECRET

# OAuth
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# AI API Keys
wrangler secret put OPENAI_API_KEY
wrangler secret put GEMINI_API_KEY
```

---

## 📊 配置对比表

| 配置项 | wrangler.jsonc | .dev.vars | .env.local |
|--------|----------------|-----------|------------|
| D1 绑定 | ✅ | ❌ | ❌ |
| R2 绑定 | ✅ | ❌ | ❌ |
| R2 访问密钥 | ❌ | ✅ | ❌ |
| Cloudflare 账户信息 | ❌ | ❌ | ✅ |
| Better Auth Secret | ❌ | ✅ | ❌ |
| Better Auth URL | ❌ | ❌ | ✅ |
| OAuth 密钥 | ❌ | ✅ | ❌ |
| AI API Keys | ❌ | ✅ | ❌ |
| 提交到 Git | ✅ | ❌ | ❌ |

---

## 📦 R2 预签名 URL 配置

### 获取 R2 访问密钥

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 R2 页面
3. 点击 "Manage R2 API Tokens"
4. 创建新的 API Token：
   - 权限：Object Read & Write
   - 选择 bucket：`picx-papers`
5. 保存生成的 Access Key ID 和 Secret Access Key

### 获取 Account ID

- 在 Cloudflare Dashboard 右侧可以找到
- 或者在 R2 页面 URL 中：`https://dash.cloudflare.com/<account-id>/r2`

### 客户端上传流程

1. **获取预签名 URL**
```typescript
const { uploadUrl, r2Key, expiresIn } = await trpc.upload.getPresignedUrl.mutate({
  filename: 'document.pdf',
  contentType: 'application/pdf',
  fileSize: file.size
});
```

2. **上传文件到预签名 URL**
```typescript
await fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: {
    'Content-Type': 'application/pdf'
  }
});
```

3. **保存 r2Key 到数据库**

### 技术细节

- 使用 `@aws-sdk/client-s3` 和 `@aws-sdk/s3-request-presigner` 生成预签名 URL
- R2 S3 兼容端点：`https://<account-id>.r2.cloudflarestorage.com`
- 支持的文件类型：PDF（`application/pdf`）
- 最大文件大小：50MB
- 预签名 URL 有效期：3600 秒（1 小时）

### 安全注意事项

1. **不要提交 `.dev.vars` 文件到 git**（已在 `.gitignore` 中配置）
2. **使用最小权限原则**：API Token 只授予必要的权限
3. **定期轮换密钥**：建议每 90 天更换一次 API Token
4. **预签名 URL 有效期**：默认 1 小时，可根据需要调整

---

## 🐛 故障排查

### 错误：R2 credentials not configured

- 检查环境变量是否正确设置
- 本地开发：确认 `.dev.vars` 文件存在且格式正确
- 生产环境：确认已使用 `wrangler secret put` 设置所有密钥

### 错误：Failed to generate upload URL

- 检查 Account ID 是否正确
- 检查 API Token 权限是否足够
- 检查 bucket 名称是否正确（`picx-papers`）
- 查看 Worker 日志获取详细错误信息：`wrangler tail`

### 本地开发无法连接数据库

- 确认已运行 `wrangler d1 migrations apply picx-db --local`
- 检查 `wrangler.jsonc` 中的 `database_id` 是否正确
- 删除 `.wrangler/state` 目录后重新运行迁移

---

## ❓ 常见问题

### Q: 为什么要分 `.dev.vars` 和 `.env.local`？
A:
- `.dev.vars` 是 Wrangler 专用的，变量会注入到 Worker 运行时
- `.env.local` 是给 Vite、Drizzle Kit 等构建工具使用的
- 两者作用域不同，不能混用

### Q: 本地开发时数据存在哪里？
A:
- D1：`.wrangler/state/v3/d1/` 本地 SQLite 文件
- R2：`.wrangler/state/v3/r2/` 本地目录
- Queues：本地内存模拟
- Durable Objects：本地存储

### Q: 如何使用远程资源开发？
A: 使用 `wrangler dev --remote` 命令，会连接到 Cloudflare 的预览环境

### Q: 为什么删除了 `wrangler.toml`？
A: 统一使用 JSONC 格式，获得更好的 IDE 支持和 schema 验证

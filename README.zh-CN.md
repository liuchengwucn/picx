# PicX

[Nano Banana 2](https://blog.google/innovation-and-ai/technology/ai/nano-banana-2/) 的白板图生成能力很棒，[Emergent Mind](https://www.emergentmind.com/) 的论文总结能力很棒，要是它们有一个开源的、方便研究社区使用的方案就更棒了。

基于 TanStack Start 和 Cloudflare Workers 构建的现代化 PDF 处理和可视化 Web 应用。

如果这个项目对你有帮助，请考虑给它一个 star ⭐

[English](README.md) | 简体中文

## 效果演示

![论文分析示例](public/paper-example.webp)

![白板图示例](public/whiteboard-example.webp)

## 功能特性

- **PDF 处理**：上传和处理 PDF 文档，支持高级解析功能
- **交互式白板**：通过直观的白板界面可视化和组织想法
- **用户认证**：基于 Better Auth 的安全用户认证
- **国际化**：完整支持英文、简体中文、繁体中文和日文
- **现代化 UI**：使用 Tailwind CSS 和 Shadcn 组件的响应式设计
- **实时更新**：通过 TanStack Query 实现乐观 UI 更新
- **类型安全 API**：使用 tRPC 实现端到端类型安全

## 技术栈

### 前端
- **框架**：TanStack Start
- **UI 组件**：Shadcn UI
- **样式**：Tailwind CSS v4
- **状态管理**：TanStack Store
- **数据获取**：TanStack Query
- **表单**：TanStack Form
- **表格**：TanStack Table
- **路由**：TanStack Router

### 后端
- **运行时**：Cloudflare Workers
- **数据库**：Cloudflare D1 (SQLite)
- **存储**：Cloudflare R2
- **ORM**：Drizzle ORM
- **API**：tRPC
- **认证**：Better Auth & GitHub OAuth

### 开发工具
- **语言**：TypeScript
- **构建工具**：Vite
- **代码检查和格式化**：Biome
- **测试**：Vitest
- **国际化**：Paraglide JS

## 本地开发

### 前置要求

- Node.js 18+ 和 npm
- Cloudflare 账号（用于部署）

### 安装步骤

1. 克隆仓库：
```bash
git clone https://github.com/liuchengwucn/picx.git
cd picx
```

2. 安装依赖：
```bash
npm install
```

3. 配置环境变量：
```bash
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars` 并配置以下内容：

**本地开发必需：**
- `BETTER_AUTH_SECRET`：使用 `npx -y @better-auth/cli secret` 生成
- `BETTER_AUTH_URL`：本地开发设置为 `http://localhost:3000`

**OAuth 登录必需（如果使用 GitHub 登录）：**
- `GITHUB_CLIENT_ID`：你的 GitHub OAuth 应用客户端 ID
- `GITHUB_CLIENT_SECRET`：你的 GitHub OAuth 应用客户端密钥

**试用访客模式（可选）：**
- `VITE_ENABLE_REVIEW_GUEST`：仅当你明确希望在本地开发时启用试用访客模式时设置为 `true`。默认关闭。

**AI 功能必需：**
- `OPENAI_API_KEY`：你的 OpenAI API 密钥（用于论文总结）
- `OPENAI_BASE_URL`：OpenAI API 端点（默认：`https://api.openai.com/v1`）
- `OPENAI_MODEL`：使用的模型（例如：`gpt-5.2-instant`、`gpt-5.2-thinking`）
- `GEMINI_API_KEY`：你的 Google Gemini API 密钥（用于白板图生成）
- `GEMINI_BASE_URL`：Gemini API 端点（默认：`https://generativelanguage.googleapis.com/v1beta`）
- `GEMINI_MODEL`：使用的模型（例如：`gemini-3.1-flash-image-preview`）

**生产部署必需：**
- `CLOUDFLARE_ACCOUNT_ID`：你的 Cloudflare 账号 ID
- `CLOUDFLARE_D1_DATABASE_ID`：你的 D1 数据库 ID
- `CLOUDFLARE_API_TOKEN`：具有 D1 权限的 Cloudflare API 令牌

**可选：**
- `CF_API_TOKEN`：用于使用 Cloudflare AI Gateway

4. 设置数据库：

```bash
# 生成迁移文件
npm run db:generate

# 在本地应用迁移（使用 wrangler.jsonc 中的数据库名称）
npx wrangler d1 migrations apply picx-db --local
```

### 运行开发服务器

```bash
npm run dev
```

应用将在 `http://localhost:3000` 上运行。

### 生产构建

```bash
npm run build
```

### 部署

部署到 Cloudflare Workers：

```bash
npm run deploy
```

确保你已在 `wrangler.jsonc` 中配置了 Cloudflare 账号详情和绑定。

**设置生产环境密钥：**

为了安全起见，敏感的环境变量（API 密钥、密钥）应该使用 Wrangler secrets 设置，而不是存储在文件中：

```bash
# 设置 Better Auth 密钥
npx wrangler secret put BETTER_AUTH_SECRET

# 设置 OAuth 凭证
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET

# 设置 AI API 密钥
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY

# 可选：设置 Cloudflare AI Gateway 令牌
npx wrangler secret put CF_API_TOKEN
```

你还需要：
1. 创建 D1 数据库：`npx wrangler d1 create picx-db`
2. 将步骤 1 中的 ID 更新到 `wrangler.jsonc` 的 `database_id` 字段
3. 将迁移应用到生产环境：`npx wrangler d1 migrations apply picx-db`
4. 创建生产和预览 R2 存储桶：
   - `npx wrangler r2 bucket create picx-papers-apac --location apac`
   - `npx wrangler r2 bucket create picx-papers-apac-preview --location apac`
5. 创建队列：`npx wrangler queues create paper-processing`

### 测试

运行测试：
```bash
npm run test
```

### 代码质量

```bash
# 代码检查
npm run lint

# 代码格式化
npm run format

# 同时检查代码规范和格式
npm run check
```

## 项目结构

```
picx/
├── src/
│   ├── routes/          # 基于文件的路由
│   ├── components/      # React 组件
│   ├── lib/             # 工具函数和配置
│   ├── workers/         # Cloudflare Workers 代码
│   ├── db/              # 数据库模式和查询
│   ├── hooks/           # React hooks
│   ├── types/           # TypeScript 类型定义
│   └── paraglide/       # 生成的国际化文件
├── drizzle/             # 数据库迁移
├── public/              # 静态资源
└── wrangler.jsonc       # Cloudflare Workers 配置
```

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

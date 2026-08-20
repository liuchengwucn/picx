# PicX

**从发现到精读，你的一站式论文工作台。**

追踪 AI 社区正在讨论什么，发现任意领域中值得读的论文，在 AI 陪伴下读完全文，并一键把它变成一张可视化白板图。

免费、开源，完整跑在 Cloudflare 边缘网络上。线上地址：**[picx.dev](https://picx.dev)**。

如果这个项目对你有帮助，请考虑给它一个 star ⭐

[English](README.md) | 简体中文

## 效果演示

![论文分析示例](public/paper-example.webp)

![白板图示例](public/whiteboard-example.webp)

## 功能特性

### 追踪

- **AI 前沿新闻**（`/news`）——每小时聚合实验室博客、研究者博客、X 和 Hacker News。LLM 流水线负责相关性打分、生成要点、关联同题报道、挑选题图，并用向量去重。异常源会触发熔断并自动恢复。
- **每周画廊**（`/gallery`）——把每周精选整理成可翻阅的刊物，包含各方向的期号页、分类页和完整归档。
- **方向周报**——一个 Cloudflare Workflow 每周跨 arXiv、RSS 与 Semantic Scholar 挖掘每个追踪方向，再经打分、精读、校验、合成产出一期内容。三个月时效硬闸拦住过期材料。

### 发现

- **研究助手**（`/assistant`）——一个会联网搜索、帮你找到值得读的论文的 agent。生成过程托管在 Durable Object 里，断连不会丢失回复，会话可以干净地恢复。
- **技能**（`/assistant/skills`）——助手可复用的指令集。内置若干默认技能，也可以自己写。

### 阅读

- **论文工作台**（`/papers`、`/p/{shortId}`）——上传 PDF 或粘贴 arXiv 链接。论文经 MinerU 解析为全文，随后生成摘要、TLDR，并翻译成全部四种语言。
- **双阅读器**——排版调校过的全文阅读器（含 KaTeX 与代码高亮），以及原始 PDF。选中任意句子即可就它提问。
- **分享**——短链、自动生成的分享图，以及面向 LLM 的纯 Markdown `/p/{shortId}.md` 。

### 讨论

- **论文 chatbot**——带着论文上下文逐段深入讨论。

### 此外

- **一键白板图**——把任意论文变成一张可视化白板图，提示词库开放在 `/whiteboard-prompts` 。
- **积分与 BYOK**——每日签到领积分，`/credits` 查看流水；`/api-configs` 支持自带 API key（加密存储）。
- **AI 可见性（GEO）**——`/llms.txt`、`/llms-full.txt`、按内容协商返回的单篇 Markdown、站点地图，以及 IndexNow 主动推送。
- **自动发推**——每日定时把精选发布到 X。
- **PWA**——可安装，带移动端底部标签栏。
- **国际化**——完整支持英文、简体中文、繁体中文和日文。

## 技术栈

### 前端

- **框架**：TanStack Start（Router、Query、Form、Table、Store）
- **UI**：基于 Radix 的 Shadcn UI、Tailwind CSS v4
- **阅读器**：pdf.js、react-markdown、KaTeX
- **国际化**：Paraglide JS

### 后端

- **运行时**：Cloudflare Workers
- **数据库**：Cloudflare D1（SQLite）+ Drizzle ORM
- **存储**：Cloudflare R2
- **异步**：Cloudflare Queues（论文处理）、Workflows（方向周报）、Durable Objects（聊天托管）、Cron Triggers
- **向量嵌入**：Workers AI
- **API**：tRPC
- **认证**：Better Auth + GitHub OAuth
- **AI**：Vercel AI SDK v7，经 OpenAI 兼容端点、OpenRouter 与 Gemini 调用

### 开发

- **语言**：TypeScript
- **构建**：Vite
- **检查与格式化**：Biome
- **测试**：Vitest

## 快速开始

### 环境要求

- **Node.js 24+** 与 npm
- 一个 Cloudflare 账号（用于部署；本地开发跑在 Wrangler 的本地模拟环境上）

### 安装

```bash
git clone https://github.com/liuchengwucn/picx.git
cd picx
npm install
```

### 环境变量

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` 会被 Wrangler 在运行时读取，也会被 Drizzle Kit 通过 dotenv 读取。本地启动的最小配置：

| 变量 | 说明 |
| --- | --- |
| `BETTER_AUTH_SECRET` | 用 `npx -y @better-auth/cli secret` 生成 |
| `BETTER_AUTH_URL` | 填 `http://localhost:3000` |

想体验 AI 功能，还需要 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`（摘要、聊天）、`GEMINI_API_KEY` / `GEMINI_BASE_URL` / `GEMINI_MODEL`（白板图生成）以及 `MINERU_TOKEN`（PDF 转全文，从 [mineru.net](https://mineru.net) 获取）。GitHub 登录需要 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`。

其余部分——新闻聚合、方向周报、发推、Telegram 告警、IndexNow、管理员权限——都是可选的，说明就写在 `.dev.vars.example` 里。

### 数据库

```bash
# 修改 src/db/schema.ts 后生成迁移文件
npm run db:generate

# 把迁移应用到本地 D1 模拟环境
npx wrangler d1 migrations apply picx-db --local
```

> **迁移一律走 Wrangler。** `db:migrate`、`db:push`、`db:pull` 已被刻意封禁——`drizzle-kit migrate` 会从 `0000` 重新执行（而 `0001`/`0002` 里含 `DELETE`），`push`/`pull` 则完全绕过迁移历史。

### 运行

```bash
npm run dev      # http://localhost:3000
npm run build    # 生产构建（不做类型检查）
npm run preview
```

## 脚本命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器，端口 3000 |
| `npm run build` | Vite 生产构建——不检查类型 |
| `npm run test` | Vitest |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | Biome 检查 **加** 类型检查——提交前跑这条 |
| `npm run lint` / `npm run format` | 单独跑 Biome |
| `npm run db:generate` | 生成 Drizzle 迁移 |
| `npm run db:studio` | Drizzle Studio |
| `npm run deploy` | 构建并 `wrangler deploy` |

## 部署

用 `npm run deploy` 部署到 Cloudflare Workers。Workflows 和 Durable Objects 由部署本身创建，下面这些有状态资源需要事先存在。

```bash
# D1——把返回的 id 填进 wrangler.jsonc
npx wrangler d1 create picx-db
npx wrangler d1 migrations apply picx-db --remote

# R2（生产桶 + preview 桶）
npx wrangler r2 bucket create picx-papers-apac --location apac
npx wrangler r2 bucket create picx-papers-apac-preview --location apac

# Queues（死信队列也必须存在）
npx wrangler queues create paper-processing
npx wrangler queues create paper-processing-dlq
```

密钥用 Wrangler secret 设置，不要写进文件：

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put MINERU_TOKEN
npx wrangler secret put API_KEY_ENCRYPTION_SECRET   # 用于加密用户自带的 API key
```

`wrangler.jsonc` 还注册了六个 cron 触发器：每日 arXiv 抓取、三条错峰发推、每小时新闻流水线，以及每周方向周报。注意 Cloudflare 的 cron 星期字段是 `1 = 周日 .. 7 = 周六`，所以周报用的是 `SAT` 缩写。

## 项目结构

```
picx/
├── src/
│   ├── routes/          # 文件式路由（页面 + API 路由）
│   ├── components/      # React 组件
│   ├── lib/             # 领域逻辑：论文、新闻、周报、聊天、技能、GEO
│   ├── workers/         # 定时任务处理器与论文处理队列消费者
│   ├── workflows/       # Cloudflare Workflows（每周方向周报）
│   ├── integrations/    # tRPC 路由、Better Auth、TanStack Query 配置
│   ├── db/              # Drizzle schema
│   └── paraglide/       # 生成的 i18n 运行时
├── drizzle/             # D1 迁移
├── messages/            # i18n 文案（en、zh-CN、zh-TW、ja）
├── scripts/             # 回填与种子脚本
├── test/                # 测试辅助与 mock
└── wrangler.jsonc       # Workers 配置：绑定、cron、队列、workflows
```

## 许可证

本项目基于 MIT 许可证开源——详见 [LICENSE](LICENSE) 文件。

# 论文总结与思维导图生成系统 - Phase 5-10 设计文档

> **创建日期：** 2026-03-05
> **状态：** 已批准
> **前置条件：** Phase 1-4 已完成（数据库 schema、用户系统、R2 配置、tRPC API）

---

## 概述

本文档详细设计 Phase 5-10 的实现方案，涵盖异步任务处理、PDF 解析、AI 集成、实时状态推送、前端页面和国际化。

**核心目标：**
- 实现完整的论文处理流程（PDF 提取 → AI 总结 → 思维导图生成）
- 提供实时状态更新的用户体验
- 支持中英文双语界面

---

## Phase 5: Cloudflare Queues 配置

### 架构设计

**队列策略：** 单队列串行处理

- **队列名称：** `paper-processing`
- **处理流程：**
  1. 如果是 arXiv 链接，先下载 PDF 到 R2
  2. 使用 `pdfjs-serverless` 提取文本
  3. 调用 OpenAI API 生成总结和思维导图结构
  4. 调用 Gemini API 生成思维导图图片
  5. 更新数据库状态，通过 Durable Objects 推送 SSE 事件

**选择理由：**
- 论文处理本身是串行依赖的（文本 → 总结 → 图片）
- 简单可靠，易于调试和监控
- 失败重试逻辑清晰

### 配置细节

**wrangler.toml 配置：**
```toml
[[queues.producers]]
binding = "PAPER_QUEUE"
queue = "paper-processing"

[[queues.consumers]]
queue = "paper-processing"
max_batch_size = 1
max_retries = 3
dead_letter_queue = "paper-processing-dlq"
```

**Queue Consumer Worker：**
- 文件：`src/workers/queue-consumer.ts`
- 职责：处理队列消息，执行完整的论文处理流程
- 每个步骤更新 `papers.status` 字段：
  - `pending` → `processing_text` → `processing_image` → `completed`
  - 失败时设置为 `failed`，记录 `errorMessage`

### 错误处理策略

**可重试错误（抛出异常，让队列重试）：**
- 网络超时
- API 限流（429）
- 临时服务错误（500）

**不可重试错误（标记 failed，不重试）：**
- PDF 文件损坏
- 文本提取失败
- 内容违规（400）
- 积分不足（理论上不会发生，因为创建时已检查）

**重试配置：**
- 最多重试 3 次
- 失败后进入死信队列 `paper-processing-dlq`

---

## Phase 6: PDF 处理服务

### 技术选型

**库：** `pdfjs-serverless`（https://github.com/johannschopplich/pdfjs-serverless）

**选择理由：**
- 专为 serverless 环境优化
- 在 Cloudflare Workers 中可靠运行
- 支持文本提取和元数据读取

### 处理流程

#### 1. 文件获取

**上传文件：**
- 直接从 R2 读取 PDF（使用 `papers.pdfR2Key`）

**arXiv 文件：**
- 从 arXiv URL 下载 PDF
  - URL 格式：`https://arxiv.org/pdf/{id}.pdf`
  - 示例：`https://arxiv.org/pdf/2301.12345.pdf`
- 上传到 R2
  - 路径：`papers/{userId}/{timestamp}-arxiv-{id}.pdf`
  - 更新 `papers.pdfR2Key` 字段

#### 2. 文本提取

**基本流程：**
- 使用 `pdfjs-serverless` 提取所有页面文本
- 合并为单个文本字符串

**长文本处理：**
- 如果文本超过 OpenAI API 的 token 限制（约 128k tokens）：
  1. 按段落或页面分块（每块约 30k tokens）
  2. 对每块调用 OpenAI 生成摘要
  3. 将所有摘要拼接后再进行最终总结

#### 3. 元数据提取

- 提取页数（`pageCount`）
- 提取文件大小（`fileSize`）
- 更新 `papers` 表对应字段

### 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| arXiv 下载失败 | 重试 3 次，失败后标记 `failed` |
| PDF 文件损坏 | 不重试，直接标记 `failed` |
| 文本提取失败 | 不重试，直接标记 `failed` |

---

## Phase 7: AI 集成

### OpenAI API 集成

**模型：** `gpt-5-mini`（默认，可通过环境变量配置）

#### 任务 1：生成论文总结

**输入：** 提取的文本

**Prompt 设计：**
```
你是一个专业的学术论文分析助手。请阅读以下论文内容，生成一份简洁的总结（500-1000字）。

总结应包括：
1. 研究背景和动机
2. 主要方法和技术
3. 核心发现和结论
4. 研究意义和影响

论文内容：
{extracted_text}
```

**输出：** 保存到 `paperResults.summary`

#### 任务 2：生成思维导图结构

**输入：** 论文总结

**Prompt 设计：**
```
基于以下论文总结，生成一个思维导图的 JSON 结构。

要求：
- 中心主题：论文的核心主题
- 3-5 个主要分支：代表论文的主要部分
- 每个分支包含 2-4 个子节点：具体的要点

JSON 格式：
{
  "center": "中心主题",
  "branches": [
    {
      "title": "分支标题",
      "nodes": ["子节点1", "子节点2", "子节点3"]
    }
  ]
}

论文总结：
{summary}
```

**输出：** 保存到 `paperResults.mindmapStructure`（JSON 字符串）

### Gemini API 集成

**模型：** `gemini-3.1-flash-image-preview`（默认，可通过环境变量配置）

#### 任务：生成思维导图图片

**输入：** 思维导图结构（JSON）

**Prompt 设计：**
```
生成一个清晰、美观的思维导图图片，基于以下结构：

{mindmap_structure}

要求：
- 中心主题居中，使用较大字体
- 主要分支围绕中心放射状排列
- 子节点连接到对应的分支
- 使用不同颜色区分不同分支
- 整体布局清晰，易于阅读
```

**输出：**
- 图片保存到 R2：`mindmaps/{userId}/{paperId}.png`
- 路径保存到 `paperResults.mindmapImageR2Key`

### 错误处理

| 错误类型 | HTTP 状态码 | 处理方式 |
|---------|------------|---------|
| API 限流 | 429 | 等待后重试，最多 3 次 |
| 服务错误 | 500 | 重试 3 次 |
| 内容违规 | 400 | 不重试，标记 `failed` |
| Token 超限 | 400 | 总结阶段：使用分段总结<br>思维导图阶段：简化结构 |

### 环境变量

| 变量名 | 说明 | 默认值 |
|-------|------|--------|
| `OPENAI_API_KEY` | OpenAI API 密钥 | 必填 |
| `OPENAI_BASE_URL` | OpenAI API base URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | OpenAI 模型名称 | `gpt-5-mini` |
| `GEMINI_API_KEY` | Gemini API 密钥 | 必填 |
| `GEMINI_BASE_URL` | Gemini API base URL | 可选 |
| `GEMINI_MODEL` | Gemini 模型名称 | `gemini-3.1-flash-image-preview` |

---

## Phase 8: SSE 实时更新

### Durable Objects 架构

**DO 类名：** `PaperStatusDO`

**路由策略：** 按 `userId` 路由，每个用户一个 DO 实例

**职责：**
- 维护该用户所有活跃的 SSE 连接
- 接收状态更新并广播到所有连接
- 管理连接生命周期（心跳、清理）

### 实现细节

#### 1. 建立连接

**端点：** `GET /api/sse/connect`

**流程：**
1. 前端调用端点（需要认证）
2. Worker 根据 `userId` 路由到对应的 DO 实例
3. DO 返回 SSE 响应流（`Content-Type: text/event-stream`）
4. DO 将连接添加到内部连接列表

**响应格式：**
```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"connected"}

```

#### 2. 推送更新

**端点：** `POST /api/sse/notify`（内部端点，仅 queue consumer 调用）

**请求体：**
```json
{
  "userId": "user-123",
  "paperId": "paper-456",
  "status": "processing_text",
  "progress": 30,
  "errorMessage": null
}
```

**流程：**
1. Queue consumer 处理完每个步骤后调用此端点
2. Worker 路由到对应的 DO 实例
3. DO 向所有活跃连接广播事件

**SSE 事件格式：**
```
event: paper-update
data: {"paperId":"paper-456","status":"processing_text","progress":30}

```

#### 3. 连接管理

**心跳机制：**
- DO 每 30 秒向所有连接发送 ping 事件
- 客户端收到 ping 后无需响应（SSE 是单向的）
- 如果发送失败，自动清理该连接

**连接清理：**
- 客户端主动断开：从连接列表移除
- 发送失败：从连接列表移除
- DO 定期清理（每分钟检查一次）

### 前端集成

**建立连接：**
```typescript
const eventSource = new EventSource('/api/sse/connect')

eventSource.addEventListener('paper-update', (event) => {
  const data = JSON.parse(event.data)
  // 更新 UI
})

eventSource.addEventListener('error', () => {
  // 自动重连
  setTimeout(() => {
    eventSource.close()
    // 重新建立连接
  }, 3000)
})
```

**断线重连：**
- 使用 `EventSource` 的自动重连机制
- 重连间隔：3 秒

---

## Phase 9: 前端页面

### 页面结构

#### 1. 论文列表页 (`/papers`)

**功能：**
- 显示用户所有论文（分页，每页 20 条）
- 状态筛选：全部 / 处理中 / 已完成 / 失败
- 实时状态更新（通过 SSE）
- 上传按钮（打开上传对话框）

**卡片内容：**
- 论文标题
- 状态标签（Badge）
- 创建时间
- 操作按钮：查看详情 / 删除

**状态颜色：**
- `pending`: 灰色
- `processing_text` / `processing_image`: 蓝色（动画）
- `completed`: 绿色
- `failed`: 红色

#### 2. 论文详情页 (`/papers/:id`)

**布局：**
- 左侧：论文信息和操作
- 右侧：总结和思维导图

**左侧内容：**
- 论文标题
- 来源类型（上传 / arXiv）
- 文件大小、页数
- 处理状态进度条（Progress 组件）
- 操作按钮：下载 PDF / 删除

**右侧内容：**
- 论文总结（完成后显示，支持折叠）
- 思维导图图片（完成后显示，支持放大查看）

**状态进度：**
- `pending`: 0%
- `processing_text`: 33%
- `processing_image`: 66%
- `completed`: 100%
- `failed`: 显示错误信息

#### 3. 积分历史页 (`/credits`)

**顶部：**
- 当前积分余额（大字号显示）
- 充值按钮（暂时禁用，显示"即将推出"）

**交易记录：**
- 表格显示（Table 组件）
- 列：时间 / 类型 / 金额 / 描述
- 分页（每页 20 条）

**类型颜色：**
- `initial`: 绿色（+10）
- `consume`: 红色（-10）
- `refund`: 绿色（+10）
- `purchase`: 绿色（+N）

### 上传对话框

**触发：** 点击列表页的"上传论文"按钮

**布局：** Dialog 组件，包含两个 Tab

#### Tab 1: 文件上传

**功能：**
- 拖拽或点击选择 PDF 文件
- 文件大小限制：50MB
- 文件类型限制：仅 PDF
- 上传前检查积分是否足够（≥10）

**流程：**
1. 用户选择文件
2. 调用 `upload.getPresignedUrl` 获取预签名 URL
3. 使用 `fetch` 直接上传到 R2
4. 上传成功后调用 `paper.create` 创建记录
5. 关闭对话框，跳转到详情页

#### Tab 2: arXiv 链接

**功能：**
- 输入框：输入 arXiv URL
- URL 验证：格式必须为 `https://arxiv.org/abs/{id}` 或 `https://arxiv.org/pdf/{id}.pdf`
- 上传前检查积分是否足够（≥10）

**流程：**
1. 用户输入 URL
2. 验证格式
3. 调用 `paper.create`（传入 arXiv URL）
4. 关闭对话框，跳转到详情页

### UI 组件（shadcn/ui）

| 组件 | 用途 |
|------|------|
| Card | 论文卡片 |
| Button | 各种操作按钮 |
| Badge | 状态标签 |
| Dialog | 上传对话框 |
| Table | 积分历史表格 |
| Progress | 处理进度条 |
| Tabs | 上传方式切换 |
| Toast | 操作反馈（成功/失败提示）|
| Input | 文件名、arXiv URL 输入 |

---

## Phase 10: 国际化和测试

### 国际化（Paraglide）

**支持语言：**
- 简体中文（`zh-CN`）
- 英文（`en`）

**翻译文件结构：**
```
messages/
├── zh-CN.json
└── en.json
```

**翻译范围：**

1. **UI 文本：**
   - 按钮标签（上传、删除、下载等）
   - 页面标题（论文列表、论文详情、积分历史）
   - 表单标签（文件名、arXiv 链接等）
   - 提示信息（拖拽上传、文件大小限制等）

2. **状态文本：**
   - `pending`: "等待处理" / "Pending"
   - `processing_text`: "提取文本中" / "Extracting Text"
   - `processing_image`: "生成图片中" / "Generating Image"
   - `completed`: "已完成" / "Completed"
   - `failed`: "处理失败" / "Failed"

3. **错误消息：**
   - "积分不足" / "Insufficient credits"
   - "文件过大" / "File too large"
   - "仅支持 PDF 文件" / "Only PDF files allowed"
   - "无效的 arXiv 链接" / "Invalid arXiv URL"

4. **交易类型：**
   - `initial`: "注册赠送" / "Initial Credits"
   - `consume`: "处理论文" / "Paper Processing"
   - `refund`: "退款" / "Refund"
   - `purchase`: "购买积分" / "Purchase Credits"

**语言切换：**
- 位置：顶部导航栏右侧
- 组件：下拉菜单（Select 组件）
- 选项：🇨🇳 简体中文 / 🇺🇸 English
- 持久化：保存到 localStorage

### 测试策略

#### 1. 单元测试（Vitest）

**测试范围：**
- PDF 处理函数（`src/lib/pdf.ts`）
  - 文本提取
  - 元数据读取
  - 长文本分块
- AI API 调用封装（`src/lib/ai.ts`）
  - OpenAI 总结生成
  - 思维导图结构生成
  - Gemini 图片生成
- R2 工具函数（`src/lib/r2.ts`）
  - 预签名 URL 生成
  - 文件上传/下载
  - 文件删除

**Mock 策略：**
- Mock R2Bucket 接口
- Mock OpenAI/Gemini API 响应
- 使用测试 PDF 文件

#### 2. 集成测试（Vitest + Miniflare）

**测试范围：**
- tRPC API 端点
  - `user.getProfile`
  - `user.getCreditHistory`
  - `paper.create`
  - `paper.list`
  - `paper.getById`
  - `paper.delete`
  - `upload.getPresignedUrl`
- Queue consumer 处理流程
  - 完整的论文处理流程
  - 错误处理和重试

**环境：**
- 使用 Miniflare 模拟 Cloudflare Workers 环境
- 使用内存 D1 数据库
- Mock R2 和外部 API

#### 3. 端到端测试（Playwright）

**测试场景：**
1. **用户注册和登录**
   - 注册新用户
   - 验证初始积分（10）
2. **上传论文（文件）**
   - 选择 PDF 文件
   - 上传成功
   - 跳转到详情页
3. **上传论文（arXiv）**
   - 输入 arXiv URL
   - 创建成功
   - 跳转到详情页
4. **实时状态更新**
   - 建立 SSE 连接
   - 验证状态更新
   - 验证进度条变化
5. **查看论文详情**
   - 查看总结
   - 查看思维导图
   - 下载 PDF
6. **删除论文**
   - 软删除
   - 验证列表中不再显示
7. **查看积分历史**
   - 验证交易记录
   - 验证分页

**环境：**
- 使用测试环境（preview 部署）
- 使用测试账号
- 使用测试 PDF 文件

### 部署

**命令：**
```bash
npm run deploy
```

**部署步骤：**
1. 运行测试（`npm test`）
2. 构建前端（`npm run build`）
3. 部署 Workers（`wrangler deploy`）
4. 应用 D1 迁移（`wrangler d1 migrations apply`）

**环境变量配置：**
- 在 Cloudflare Dashboard 中配置生产环境变量
- 或使用 `wrangler secret put` 命令

**自定义域名（可选）：**
- 在 Cloudflare Dashboard 中配置
- 添加 DNS 记录
- 配置 SSL 证书（自动）

---

## 总结

本设计文档详细规划了 Phase 5-10 的实现方案，涵盖：

1. **Phase 5：** Cloudflare Queues 单队列串行处理
2. **Phase 6：** 使用 `pdfjs-serverless` 处理 PDF，支持长文本分段总结
3. **Phase 7：** 集成 OpenAI（`gpt-5-mini`）和 Gemini（`gemini-3.1-flash-image-preview`）
4. **Phase 8：** 使用 Durable Objects + SSE 实现实时状态推送
5. **Phase 9：** 实现论文列表、详情、积分历史三个页面
6. **Phase 10：** 配置 Paraglide 国际化，编写单元/集成/端到端测试

**关键技术决策：**
- 单队列串行处理（简单可靠）
- `pdfjs-serverless`（Workers 兼容）
- Durable Objects + SSE（实时推送）
- 长文本分段总结（避免 token 限制）
- 环境变量配置 AI API（灵活性）

**下一步：**
调用 `writing-plans` skill 创建详细的实施计划。

# 论文总结与思维导图生成系统 - 设计文档

**日期**: 2026-03-05
**版本**: 1.0
**状态**: 已批准

## 1. 项目概述

### 1.1 目标
开发一个 serverless 系统，允许用户上传 PDF 论文或提供 arXiv 链接，系统自动生成：
- 论文总结（文本）
- 思维导图结构（JSON）
- 思维导图可视化图片

### 1.2 核心特性
- 用户认证和积分系统
- 异步任务处理
- 实时状态更新（SSE）
- 文件存储和管理
- 软删除机制

### 1.3 技术约束
- 必须使用 Cloudflare 技术栈
- 支持简体中文和英文国际化
- 采用固定积分消费模式（10 credits/次）
- 新用户注册赠送 10 credits

## 2. 整体架构

### 2.1 技术栈
- **全栈框架**: TanStack Start（部署到 Cloudflare Workers）
- **数据库**: Cloudflare D1（SQLite）
- **文件存储**: Cloudflare R2
- **异步队列**: Cloudflare Queues
- **实时通信**: Server-Sent Events（SSE）
- **AI 服务**: OpenAI API + Gemini Nano Banana 2 API
- **认证**: Better Auth
- **ORM**: Drizzle
- **API 层**: tRPC
- **UI 组件**: shadcn/ui + Tailwind CSS
- **国际化**: Paraglide

### 2.2 架构图

```
用户浏览器
    ↓
TanStack Start (Cloudflare Workers)
    ├─→ tRPC API 路由
    ├─→ Better Auth (用户认证)
    ├─→ Cloudflare D1 (用户、积分、任务状态)
    ├─→ Cloudflare R2 (PDF 文件、生成的图片)
    └─→ Cloudflare Queues
         ├─→ Queue Consumer 1: PDF 处理 + OpenAI 总结
         └─→ Queue Consumer 2: Gemini 图片生成
```

### 2.3 核心流程

#### 阶段 1: 用户上传论文
1. 用户上传 PDF 或输入 arXiv 链接
2. 检查用户积分是否足够（固定 10 credits）
3. 文件上传到 R2，创建任务记录（状态: pending）
4. 扣除积分，将任务推送到 Queue 1

#### 阶段 2: 异步处理 - 文本生成
1. Queue Consumer 1 接收任务
2. 从 R2 下载 PDF，提取文本内容
3. 调用 OpenAI API 生成：
   - 论文总结
   - 思维导图结构（JSON）
   - 图片生成 prompt
4. 保存结果到 D1
5. 更新任务状态（processing_text → processing_image）
6. 将图片生成任务推送到 Queue 2

#### 阶段 3: 异步处理 - 图片生成
1. Queue Consumer 2 接收任务
2. 调用 Gemini Nano Banana 2 API 生成思维导图图片
3. 图片保存到 R2
4. 更新任务状态（processing_image → completed）

#### 阶段 4: 实时状态更新
1. 前端通过 SSE 连接订阅任务状态
2. 任务状态变化时，服务器推送更新到客户端
3. 前端实时显示处理进度

## 3. 数据库设计

### 3.1 users 表
Better Auth 自动创建，扩展字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| email | TEXT | 邮箱 |
| name | TEXT | 用户名 |
| credits | INTEGER | 积分余额（默认 10） |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

### 3.2 papers 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| user_id | TEXT | 用户 ID（外键） |
| title | TEXT | 论文标题 |
| source_type | TEXT | 来源类型（'upload' \| 'arxiv'） |
| source_url | TEXT | arXiv 链接（可选） |
| pdf_r2_key | TEXT | PDF 在 R2 的存储路径 |
| file_size | INTEGER | 文件大小（字节） |
| page_count | INTEGER | 页数 |
| status | TEXT | 处理状态 |
| error_message | TEXT | 错误信息（可选） |
| deleted_at | TIMESTAMP | 软删除时间（NULL 表示未删除） |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

**状态枚举**:
- `pending`: 等待处理
- `processing_text`: 正在生成文本
- `processing_image`: 正在生成图片
- `completed`: 完成
- `failed`: 失败

### 3.3 paper_results 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| paper_id | TEXT | 论文 ID（外键） |
| summary | TEXT | 论文总结 |
| mindmap_structure | TEXT | 思维导图结构（JSON） |
| mindmap_image_r2_key | TEXT | 思维导图图片在 R2 的路径 |
| image_prompt | TEXT | 生成图片的 prompt |
| processing_time_ms | INTEGER | 处理耗时（毫秒） |
| created_at | TIMESTAMP | 创建时间 |

### 3.4 credit_transactions 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| user_id | TEXT | 用户 ID（外键） |
| amount | INTEGER | 积分变动（正数为增加，负数为消费） |
| type | TEXT | 交易类型 |
| related_paper_id | TEXT | 关联的论文 ID（可选） |
| description | TEXT | 描述 |
| created_at | TIMESTAMP | 创建时间 |

**交易类型枚举**:
- `initial`: 注册赠送
- `consume`: 消费
- `refund`: 退款
- `purchase`: 购买（未来扩展）

### 3.5 索引策略
- `papers(user_id, deleted_at, created_at)`: 用户论文列表查询
- `papers(status, deleted_at)`: 队列任务查询
- `credit_transactions(user_id, created_at)`: 积分历史查询

## 4. API 设计

### 4.1 用户相关（tRPC）

```typescript
user.getProfile()
// 返回: { id, email, name, credits }

user.getCreditHistory({ page, limit })
// 返回: { transactions: [...], total }
```

### 4.2 论文相关（tRPC）

```typescript
paper.create({
  sourceType: 'upload' | 'arxiv',
  arxivUrl?: string,
  file?: File
})
// 返回: { paperId, status }

paper.list({ page, limit, status? })
// 返回: { papers: [...], total }

paper.getById(id)
// 返回: { paper, result? }

paper.delete(id)
// 返回: { success: boolean }

paper.subscribe(id)
// SSE 流，推送状态更新
```

### 4.3 文件上传

```typescript
upload.getPresignedUrl({
  filename: string,
  contentType: string,
  fileSize: number
})
// 返回: { uploadUrl, r2Key }
```

### 4.4 SSE 事件格式

```json
{
  "type": "status_update",
  "paperId": "123",
  "status": "processing_text",
  "progress": 50,
  "message": "正在生成论文总结..."
}
```

## 5. 前端设计

### 5.1 页面结构

#### 论文列表页 (`/papers`)
- 显示用户当前积分余额
- 上传入口：支持拖拽上传 PDF 或输入 arXiv 链接
- 论文列表（TanStack Table）
  - 列：标题、来源、状态、创建时间、操作
  - 状态实时更新（SSE）
  - 操作：查看详情、删除
- 分页加载

#### 论文详情页 (`/papers/:id`)
- 论文基本信息
- 处理状态进度条
- 论文总结（Markdown 渲染）
- 思维导图结构（树形展示）
- 思维导图图片（大图展示，支持下载）
- 下载原始 PDF 按钮

#### 积分历史页 (`/credits`)
- 当前积分余额
- 积分交易记录列表
- 未来扩展：充值入口

#### 用户设置页 (`/settings`)
- 用户信息（Better Auth）
- 退出登录

### 5.2 UI 组件（shadcn/ui）
- Button, Card, Table, Badge
- Dialog（确认删除）
- Progress（处理进度）
- Tabs（详情页切换）
- Toast（操作反馈）
- Skeleton（加载状态）

### 5.3 状态管理
- **TanStack Query**: 数据获取和缓存
- **TanStack Store**: 全局状态（用户信息、积分）
- **SSE 集成**: 实时更新论文状态

## 6. 错误处理和边界情况

### 6.1 文件上传阶段
- 文件大小限制：最大 50MB
- 文件类型验证：仅允许 PDF
- arXiv 链接验证：检查格式和可访问性
- 积分不足：提示用户积分不足，无法创建任务

### 6.2 PDF 处理阶段
- PDF 损坏或无法解析：标记为 failed，返还积分
- 页数超限（>100 页）：提示用户文件过大
- arXiv 下载失败：重试 3 次，失败后返还积分

### 6.3 AI 调用阶段
- OpenAI API 失败：重试 3 次（指数退避）
- Gemini API 失败：重试 3 次
- 超时处理：单次调用超时 60 秒
- Rate limit：队列自动延迟重试

### 6.4 队列处理
- 任务失败自动重试：最多 3 次
- 死信队列：3 次失败后进入 DLQ，人工介入
- 幂等性：使用 paper_id 作为去重键，避免重复处理

### 6.5 用户体验
- 加载状态：Skeleton 占位
- 错误提示：Toast 通知
- 网络断线：SSE 自动重连
- 空状态：友好的空列表提示

### 6.6 数据一致性
- 积分扣除和任务创建：使用数据库事务
- 任务失败返还积分：自动触发 refund 交易
- R2 文件清理：定期清理 deleted_at > 30 天的文件

### 6.7 安全考虑
- 文件上传：使用预签名 URL，避免直接上传到服务器
- R2 访问：生成临时访问 URL（有效期 1 小时）
- API 认证：所有 tRPC 路由需要 Better Auth 认证
- Rate limiting：每用户每小时最多创建 10 个任务

## 7. 实施步骤概览

1. **数据库 Schema 设计**：扩展 Drizzle schema，添加新表
2. **用户系统**：扩展 Better Auth，添加积分字段
3. **文件上传**：实现 R2 预签名 URL 上传
4. **队列系统**：配置 Cloudflare Queues 和 Consumers
5. **PDF 处理**：集成 PDF 解析库
6. **AI 集成**：接入 OpenAI 和 Gemini API
7. **SSE 实现**：使用 Durable Objects 维护连接
8. **前端页面**：实现论文列表、详情、积分历史页
9. **国际化**：配置 Paraglide，添加中英文翻译
10. **测试和部署**：端到端测试，部署到 Cloudflare Workers

## 8. 未来扩展

- 支付集成（Stripe）：用户购买积分
- 管理后台：查看系统使用情况、用户管理
- 更多 AI 模型选择：让用户选择不同的 AI 模型
- 批量处理：一次上传多个论文
- 导出功能：导出为 PDF 报告
- 分享功能：生成公开链接分享结果

# 多白板图功能设计文档

## 概述

允许一篇论文对应多张白板图，用户可以选择重新生成白板图（花费 credit 或使用自己的 API）。

## 背景

当前实现中，一篇论文只能对应一张白板图，存储在 `paperResults.whiteboardImageR2Key` 字段中。用户无法重新生成或尝试不同的 prompt 来获得不同风格的白板图。

## 目标

1. 支持一篇论文对应多张白板图
2. 用户可以使用相同 prompt 重新生成（利用 AI 随机性）
3. 用户可以选择不同 prompt 模板生成新白板图
4. 支持使用用户自己的 API 配置（不扣 credit）
5. 用户可以管理白板图（设置默认、删除、下载）

## 数据模型设计

### 新增表：whiteboardImages

```typescript
whiteboardImages {
  id: uuid (主键)
  paperId: uuid (外键 -> papers.id, onDelete: cascade)
  imageR2Key: string (R2 存储的图片 key)
  promptId: uuid (使用的 prompt 模板 ID，可为 null)
  isDefault: boolean (是否为默认显示的白板图)
  createdAt: timestamp
}
```

**索引：**
- `paperId` 索引（用于查询某篇论文的所有白板图）
- `paperId + isDefault` 复合索引（快速查找默认白板图）

### 修改表：paperResults

**删除字段：**
- `whiteboardImageR2Key`（迁移到 whiteboardImages 表）
- `imagePrompt`（不再需要）

**保留字段：**
- `whiteboardInsights`（白板结构数据，所有白板图共享）

### 数据关系

- `papers` 1:1 `paperResults`（一篇论文一份处理结果）
- `papers` 1:N `whiteboardImages`（一篇论文多张白板图）
- 每篇论文至少有一张白板图标记为 `isDefault: true`

### 数据迁移

创建迁移脚本 `0010_multiple_whiteboard_images.sql`：

1. 创建 `whiteboardImages` 表
2. 将 `paperResults.whiteboardImageR2Key` 数据迁移到 `whiteboardImages`
3. 所有迁移的白板图标记为 `isDefault: true`
4. 删除 `paperResults.whiteboardImageR2Key` 和 `imagePrompt` 字段

## API 设计

### 新增 API

#### 1. 生成新白板图

```typescript
paper.regenerateWhiteboard({
  paperId: string,
  promptId?: string,
  useExistingPrompt?: boolean,
  apiConfigId?: string
})
```

**逻辑：**
- 验证论文所有权
- 验证论文状态为 `completed`
- 如果提供 `apiConfigId`，验证配置所有权，使用用户 API
- 如果不提供 `apiConfigId`，检查 credit 是否足够，扣除 1 credit
- 从 `paperResults` 获取 `whiteboardInsights`
- 根据 `promptId` 或 `useExistingPrompt` 确定使用的 prompt
- 调用 AI 生成白板图
- 保存图片到 R2
- 创建 `whiteboardImages` 记录
- 将新白板图设为默认（`isDefault: true`，其他设为 `false`）
- 返回新白板图 ID

**返回：**
```typescript
{
  whiteboardId: string,
  imageUrl: string
}
```

#### 2. 获取白板图列表

```typescript
paper.listWhiteboards(paperId: string)
```

**逻辑：**
- 验证论文访问权限（所有者或公开论文）
- 查询该论文的所有白板图
- 按创建时间倒序排列

**返回：**
```typescript
{
  whiteboards: Array<{
    id: string,
    imageR2Key: string,
    promptId: string | null,
    promptName: string | null,
    isDefault: boolean,
    createdAt: Date
  }>
}
```

#### 3. 设置默认白板图

```typescript
paper.setDefaultWhiteboard({
  paperId: string,
  whiteboardId: string
})
```

**逻辑：**
- 验证论文所有权
- 验证白板图属于该论文
- 将该论文的所有白板图 `isDefault` 设为 `false`
- 将指定白板图 `isDefault` 设为 `true`

**返回：**
```typescript
{ success: true }
```

#### 4. 删除白板图

```typescript
paper.deleteWhiteboard({
  paperId: string,
  whiteboardId: string
})
```

**逻辑：**
- 验证论文所有权
- 验证白板图属于该论文
- 检查是否至少有 2 张白板图（不能删除最后一张）
- 从 R2 删除图片文件
- 删除数据库记录
- 如果删除的是默认白板图，将最新的一张设为默认

**返回：**
```typescript
{ success: true }
```

### 修改现有 API

#### paper.getById

**新增返回字段：**
```typescript
{
  paper: {...},
  result: {
    ...,
    defaultWhiteboard: {
      id: string,
      imageR2Key: string,
      promptId: string | null,
      isDefault: true,
      createdAt: Date
    } | null
  },
  whiteboards: Array<{...}>  // 所有白板图列表
}
```

## 前端 UI 设计

### 论文详情页变更

#### 白板图展示区域

**当前显示：**
- 默认白板图的预览
- 下载按钮

**新增：**
- "查看所有白板图"按钮（显示白板图数量，如"查看所有 (3)"）
- "重新生成"按钮

#### 白板图列表对话框

**布局：**
- 网格布局（响应式，桌面 3 列，平板 2 列，手机 1 列）
- 每张白板图卡片包含：
  - 缩略图预览（点击可全屏查看）
  - 生成时间
  - 使用的 Prompt 名称（如果有）
  - "默认"徽章（当前默认的白板图）
  - 操作按钮：
    - 设为默认（非默认白板图显示）
    - 下载
    - 删除（至少保留一张）

#### 重新生成配置对话框

**表单字段：**
1. Prompt 选择
   - 下拉菜单，显示用户的所有 prompt 模板
   - 默认选中当前使用的 prompt（如果有）

2. 重新生成选项
   - 复选框："使用相同 Prompt 重新生成"
   - 勾选后禁用 Prompt 选择器

3. API 配置（可选）
   - 下拉菜单，显示用户的 API 配置
   - 默认为"使用系统 API"

4. Credit 消耗提示
   - 如果使用系统 API，显示"将消耗 1 credit"
   - 如果使用用户 API，显示"使用您的 API，不消耗 credit"

5. 确认按钮
   - "生成新白板图"

### 生成流程

1. 用户点击"重新生成"按钮
2. 打开配置对话框
3. 用户选择配置（prompt、API）
4. 点击确认，发起请求
5. 显示生成进度（复用现有 SSE 机制）
6. 生成完成后：
   - 关闭配置对话框
   - 刷新白板图列表
   - 新白板图自动设为默认并显示在主区域
   - 显示成功提示

## 队列处理

### 新增队列消息类型

```typescript
{
  type: 'regenerate_whiteboard',
  paperId: string,
  userId: string,
  promptId?: string,
  apiConfigId?: string
}
```

### 处理逻辑

1. 从 `paperResults` 获取 `whiteboardInsights`
2. 根据 `promptId` 获取 prompt 模板
3. 使用 insights 和 prompt 生成白板图
4. 保存到 R2
5. 创建 `whiteboardImages` 记录
6. 通过 SSE 通知前端完成

## 错误处理

### API 错误

- `INSUFFICIENT_CREDITS`：credit 不足
- `PAPER_NOT_FOUND`：论文不存在
- `PAPER_NOT_COMPLETED`：论文未完成处理
- `WHITEBOARD_NOT_FOUND`：白板图不存在
- `CANNOT_DELETE_LAST_WHITEBOARD`：不能删除最后一张白板图
- `API_CONFIG_NOT_FOUND`：API 配置不存在

### 生成失败处理

- 如果生成失败，不创建 `whiteboardImages` 记录
- 如果已扣除 credit，进行退款（创建 refund 交易记录）
- 通过 SSE 通知前端失败原因

## 测试要点

### 数据迁移测试

- 验证现有白板图正确迁移到新表
- 验证所有迁移的白板图标记为默认
- 验证旧字段正确删除

### API 测试

- 生成新白板图（使用系统 API）
- 生成新白板图（使用用户 API）
- 使用相同 prompt 重新生成
- 使用不同 prompt 生成
- 设置默认白板图
- 删除白板图（保留至少一张）
- 删除默认白板图（自动设置新默认）

### UI 测试

- 白板图列表显示正确
- 默认白板图标记正确
- 生成配置对话框交互正确
- 生成进度显示正确
- 错误提示显示正确

## 实现顺序

1. 数据库迁移（创建表、迁移数据）
2. 后端 API 实现
3. 队列处理逻辑
4. 前端 UI 组件
5. 集成测试
6. 部署和验证

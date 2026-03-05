# 模板代码清理设计文档

**日期**: 2026-03-05
**状态**: 已批准

## 1. 清理目标

彻底清除 init commit (fad0e042) 中的模板代码，保留纯粹的业务代码，避免模板代码与业务代码混淆。

## 2. 清理范围

### 2.1 删除文件清单（15 个）

**Demo 路由（9 个）：**
- `src/routes/demo/better-auth.tsx`
- `src/routes/demo/drizzle.tsx`
- `src/routes/demo/form.address.tsx`
- `src/routes/demo/form.simple.tsx`
- `src/routes/demo/store.tsx`
- `src/routes/demo/table.tsx`
- `src/routes/demo/tanstack-query.tsx`
- `src/routes/demo/trpc-todo.tsx`
- `src/routes/demo.i18n.tsx`

**Demo 组件和工具（6 个）：**
- `src/components/demo.FormComponents.tsx`
- `src/data/demo-table-data.ts`
- `src/hooks/demo.form-context.ts`
- `src/hooks/demo.form.ts`
- `src/lib/demo-store-devtools.tsx`
- `src/lib/demo-store.ts`

**国际化文件（1 个）：**
- `messages/de.json`（德语翻译，不在业务需求中）

### 2.2 代码修改清单

**数据库 Schema (`src/db/schema.ts`)：**
- 删除 `todos` 表定义

**tRPC Router (`src/integrations/trpc/router.ts`)：**
- 删除 `todos` 数组
- 删除 `todosRouter`
- 从 `trpcRouter` 中移除 `todos: todosRouter`

**Root 布局 (`src/routes/__root.tsx`)：**
- 检查并清理 demo 相关导入

**首页 (`src/routes/index.tsx`)：**
- 完全重写为论文系统欢迎页
- 采用学术风格设计（论文纸黄棕色调）
- 使用 frontend-design skill 指导设计

### 2.3 数据库迁移

**策略：重新生成迁移**
- 删除现有迁移文件（开发阶段，无生产数据）
- 重新生成干净的迁移（仅包含业务表）
- 业务表：users, papers, paper_results, credit_transactions

## 3. 首页设计要求

### 3.1 视觉风格
- 极简学术科技风格
- 论文纸黄棕色调（#f4f1e8）
- 磨砂纸质效果
- 微妙阴影和圆角

### 3.2 内容结构
1. **Hero 区域**
   - 系统标题和简介
   - CTA 按钮（开始使用/查看示例）
   - 视觉装饰（渐变圆形）

2. **功能特性卡片（3-4 个）**
   - PDF 上传 / arXiv 链接
   - AI 自动总结
   - 思维导图生成
   - 积分系统

3. **使用流程说明**
   - 上传论文 → AI 处理 → 获取结果
   - 简洁的步骤说明

4. **积分系统说明**
   - 新用户赠送 10 积分
   - 每次处理消耗 10 积分

## 4. 执行步骤

1. **删除文件**：删除 15 个模板文件
2. **修改代码**：清理 schema、router、root 布局
3. **重写首页**：加载 frontend-design skill，重写 index.tsx
4. **数据库迁移**：重新生成迁移文件
5. **验证**：类型检查、构建测试、引用检查

## 5. 验证标准

- 无模板代码残留
- 无 demo 路由可访问
- 首页符合学术风格设计
- 类型检查通过
- 构建成功
- 无未使用的导入或引用

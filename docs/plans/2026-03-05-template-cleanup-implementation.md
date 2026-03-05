# 模板代码清理实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 彻底清除 init commit 中的模板代码，重写首页为学术风格欢迎页

**Architecture:** 分阶段删除模板文件、清理代码引用、重写首页、重新生成数据库迁移

**Tech Stack:** TanStack Start, Drizzle ORM, tRPC, frontend-design skill

---

## Task 1: 删除 Demo 路由文件

**Files:**
- Delete: `src/routes/demo/better-auth.tsx`
- Delete: `src/routes/demo/drizzle.tsx`
- Delete: `src/routes/demo/form.address.tsx`
- Delete: `src/routes/demo/form.simple.tsx`
- Delete: `src/routes/demo/store.tsx`
- Delete: `src/routes/demo/table.tsx`
- Delete: `src/routes/demo/tanstack-query.tsx`
- Delete: `src/routes/demo/trpc-todo.tsx`
- Delete: `src/routes/demo.i18n.tsx`

**Step 1: 删除所有 demo 路由文件**

```bash
trash src/routes/demo/better-auth.tsx \
  src/routes/demo/drizzle.tsx \
  src/routes/demo/form.address.tsx \
  src/routes/demo/form.simple.tsx \
  src/routes/demo/store.tsx \
  src/routes/demo/table.tsx \
  src/routes/demo/tanstack-query.tsx \
  src/routes/demo/trpc-todo.tsx \
  src/routes/demo.i18n.tsx
```

**Step 2: 验证文件已删除**

Run: `ls src/routes/demo/ 2>&1`
Expected: "No such file or directory" 或空目录

**Step 3: 删除空的 demo 目录**

```bash
rmdir src/routes/demo 2>/dev/null || true
```

**Step 4: 提交更改**

```bash
git add -A
git commit -m "refactor: remove demo route files"
```

---

## Task 2: 删除 Demo 组件和工具文件

**Files:**
- Delete: `src/components/demo.FormComponents.tsx`
- Delete: `src/data/demo-table-data.ts`
- Delete: `src/hooks/demo.form-context.ts`
- Delete: `src/hooks/demo.form.ts`
- Delete: `src/lib/demo-store-devtools.tsx`
- Delete: `src/lib/demo-store.ts`
- Delete: `messages/de.json`

**Step 1: 删除 demo 组件和工具文件**

```bash
trash src/components/demo.FormComponents.tsx \
  src/data/demo-table-data.ts \
  src/hooks/demo.form-context.ts \
  src/hooks/demo.form.ts \
  src/lib/demo-store-devtools.tsx \
  src/lib/demo-store.ts \
  messages/de.json
```

**Step 2: 验证文件已删除**

Run: `ls src/components/demo.* src/data/demo-* src/hooks/demo.* src/lib/demo-* messages/de.json 2>&1`
Expected: "No such file or directory"

**Step 3: 提交更改**

```bash
git add -A
git commit -m "refactor: remove demo components and utilities"
```

---

## Task 3: 清理数据库 Schema

**Files:**
- Modify: `src/db/schema.ts:3-9`

**Step 1: 删除 todos 表定义**

从 `src/db/schema.ts` 中删除 todos 表定义（第 3-9 行）

**Step 2: 验证语法正确**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: 提交更改**

```bash
git add src/db/schema.ts
git commit -m "refactor: remove todos table from schema"
```

---

## Task 4: 清理 tRPC Router

**Files:**
- Modify: `src/integrations/trpc/router.ts`

**Step 1: 删除 todos 相关代码**

修改 `src/integrations/trpc/router.ts`，删除 todos 数组、todosRouter 和路由注册

**Step 2: 验证类型检查**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: 提交更改**

```bash
git add src/integrations/trpc/router.ts
git commit -m "refactor: remove todos router from tRPC"
```

---

## Task 5: 检查并清理 Root 布局

**Files:**
- Read: `src/routes/__root.tsx`

**Step 1: 检查 demo 相关导入**

Run: `grep -n "demo" src/routes/__root.tsx`
Expected: 检查是否有 demo 相关的导入或引用

**Step 2: 如果有引用，清理它们**

如果发现 demo 相关导入，删除相关代码

**Step 3: 验证类型检查**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: 如果有修改，提交更改**

```bash
git add src/routes/__root.tsx
git commit -m "refactor: remove demo references from root layout"
```

---

## Task 6: 重写首页

**Files:**
- Modify: `src/routes/index.tsx` (complete rewrite)

**Step 1: 加载 frontend-design skill**

**REQUIRED SUB-SKILL:** Use frontend-design:frontend-design skill

**Step 2: 设计首页内容结构**

根据设计文档，首页应包含：
1. Hero 区域（标题、简介、CTA 按钮）
2. 功能特性卡片（4 个）
3. 使用流程（3 步）
4. 积分说明卡片

**Step 3: 实现首页组件**

使用学术风格设计：
- 论文纸黄棕色调（#f4f1e8）
- 学术棕强调色（#8b6f47）
- 磨砂纸质效果
- 响应式布局

**Step 4: 添加国际化支持**

确保所有文本使用 Paraglide 的 m.*() 函数

**Step 5: 验证类型检查**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: 提交更改**

```bash
git add src/routes/index.tsx
git commit -m "feat: rewrite homepage with academic design style"
```

---

## Task 7: 更新国际化文件

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

**Step 1: 添加首页相关翻译**

在两个文件中添加首页所需的翻译键值

**Step 2: 验证 JSON 格式**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/en.json'))"`
Expected: No errors

**Step 3: 提交更改**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "i18n: add homepage translations"
```

---

## Task 8: 重新生成数据库迁移

**Files:**
- Delete: `drizzle/0000_sweet_morlocks.sql`
- Delete: `drizzle/meta/0000_snapshot.json`
- Delete: `drizzle/meta/_journal.json`
- Create: New migration files

**Step 1: 删除现有迁移文件**

```bash
trash drizzle/0000_sweet_morlocks.sql \
  drizzle/meta/0000_snapshot.json \
  drizzle/meta/_journal.json
```

**Step 2: 重新生成迁移**

Run: `npm run db:generate`
Expected: 生成新的迁移文件，只包含业务表

**Step 3: 检查生成的迁移文件**

Run: `cat drizzle/0000_*.sql`
Expected: 包含 4 个业务表，不包含 todos 表

**Step 4: 提交更改**

```bash
git add drizzle/
git commit -m "refactor: regenerate database migrations without todos table"
```

---

## Task 9: 最终验证

**Files:**
- All modified files

**Step 1: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: 运行构建测试**

Run: `npm run build`
Expected: Build succeeds

**Step 3: 检查未使用的导入**

Run: `npx biome check --write .`
Expected: No unused imports or variables

**Step 4: 搜索残留的 demo 引用**

Run: `grep -r "demo" src/ --exclude-dir=node_modules`
Expected: 没有代码引用

**Step 5: 搜索残留的 todos 引用**

Run: `grep -r "todos" src/ --exclude-dir=node_modules`
Expected: 没有代码引用

**Step 6: 提交最终清理**

```bash
git add -A
git commit -m "chore: final cleanup and formatting"
```

---

## Task 10: 测试首页功能

**Step 1: 启动开发服务器**

提示用户手动运行：`npm run dev`

**Step 2: 验证首页显示**

访问 http://localhost:3000/，检查所有元素正确显示

**Step 3: 测试国际化切换**

验证中英文切换正常

**Step 4: 测试导航**

验证"开始使用"按钮跳转正常

**Step 5: 验证无 demo 路由**

访问 demo 路由应返回 404

---

## 完成标准

- ✅ 所有 demo 文件已删除
- ✅ todos 表从 schema 和 router 中移除
- ✅ 首页重写为学术风格
- ✅ 国际化文件更新
- ✅ 数据库迁移重新生成
- ✅ 类型检查通过
- ✅ 构建成功
- ✅ 无未使用的导入
- ✅ 无 demo/todos 代码残留
- ✅ 首页功能测试通过

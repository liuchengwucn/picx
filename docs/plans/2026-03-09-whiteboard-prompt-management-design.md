# 白板 Prompt 管理功能设计文档

## 概述

本文档描述了白板 Prompt 自定义管理功能的设计方案。该功能允许用户创建和管理自定义的白板图生成 prompt 模板，在上传论文时可以选择使用不同的 prompt 模板来生成白板图。

## 背景

当前系统使用固定的 prompt 来生成白板图（在 `src/lib/ai.ts` 的 `buildWhiteboardPrompt` 函数中）。用户希望能够自定义 prompt，以便根据不同的需求生成不同风格的白板图。

## 需求

1. 用户可以创建多个 prompt 模板，每个模板有名称和内容
2. 用户可以设置一个默认模板
3. 如果用户没有设置默认模板，使用系统内置的 prompt
4. 上传论文时可以选择使用哪个 prompt 模板
5. 系统内置模板不显示在用户的模板列表中，也不能被删除
6. 删除默认模板时，自动回退到系统内置模板

## 设计方案

### 1. 数据库设计

创建新表 `whiteboardPrompts` 存储用户的 prompt 模板：

```sql
CREATE TABLE whiteboard_prompts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX whiteboard_prompts_user_id_idx ON whiteboard_prompts(user_id, is_default);
```

**字段说明：**
- `id`: UUID 主键
- `user_id`: 用户 ID，外键关联 user 表
- `name`: 模板名称（用户自定义文本，1-50 字符）
- `prompt_template`: Prompt 模板内容（10-3000 字符）
- `is_default`: 是否为默认模板（布尔值）
- `created_at`: 创建时间
- `updated_at`: 更新时间

**约束：**
- 每个用户只能有一个 `is_default = true` 的模板
- 模板名称在同一用户下不能重复

### 2. Prompt 模板变量

用户编写 prompt 时可以使用以下占位符：

- `{contentText}` - 论文文本或摘要（**必需，且只能出现一次**）
- `{whiteboardMarkdown}` - 白板结构的 Markdown（可选）
- `{languageInstruction}` - 语言指令，根据用户选择的语言自动生成（可选）

**验证规则：**
- Prompt 模板必须包含一个且仅有一个 `{contentText}` 占位符
- 其他占位符可选

### 3. 系统内置模板

系统内置模板不存储在数据库中，直接在代码中定义：

```typescript
function getSystemDefaultPrompt(): WhiteboardPrompt {
  return {
    id: 'system-default',
    name: m.whiteboard_prompt_system_default(), // i18n
    promptTemplate: `Transform this academic paper into a professor-style whiteboard image. Include diagrams, arrows, boxes, and short captions that explain the core ideas visually.

{languageInstruction}

Key insights to emphasize:
{whiteboardMarkdown}

Paper content:
{contentText}

Requirements:
- Create a hand-drawn whiteboard aesthetic with a clean, academic style
- Use boxes and circles to highlight key concepts from the insights above
- Draw arrows to show relationships and flow between ideas
- Include key formulas and equations prominently (extract from paper content)
- Use different sections or colors to organize main topics
- Make the text readable and well-organized
- Ensure good spacing to avoid clutter
- Use a professional, academic color palette (black, blue, red for emphasis)
- Mimic the style of a university professor explaining concepts on a whiteboard
- Focus on visualizing the insights and their connections, not just listing information`
  };
}
```

### 4. 架构设计

#### 4.1 前端路由

- `/whiteboard-prompts` - Prompt 模板管理页面

#### 4.2 tRPC 路由

在 `src/integrations/trpc/routers/` 下创建 `whiteboard-prompt.ts`：

```typescript
- whiteboardPrompt.list - 获取用户的所有 prompt 模板
- whiteboardPrompt.create - 创建新模板
- whiteboardPrompt.update - 更新模板（名称、内容、是否默认）
- whiteboardPrompt.delete - 删除模板
```

#### 4.3 数据流

1. 用户在 `/whiteboard-prompts` 页面管理自己的模板
2. 上传论文时：
   - 如果用户有自定义模板，显示模板选择器
   - 如果用户没有自定义模板，自动使用系统内置模板
3. 后端生成白板图时：
   - 根据 `promptId` 获取对应的模板
   - 如果 `promptId` 为空或无效，使用用户的默认模板
   - 如果用户没有默认模板，使用系统内置模板
4. 删除模板时：
   - 如果删除的是默认模板且还有其他模板，自动将最早创建的模板设为默认
   - 如果删除后没有任何自定义模板，自动回退到系统内置模板

### 5. UI/UX 设计

#### 5.1 Prompt 管理页面 (`/whiteboard-prompts`)

页面布局参考 `/api-configs`，包含：

**页面头部：**
- 页面标题（i18n）
- 页面描述（i18n）
- "创建新模板"按钮（右上角）

**模板列表：**
- 卡片式布局，每个卡片显示：
  - 模板名称
  - 创建时间
  - 默认标记（如果是默认模板）
  - 操作按钮：编辑、删除、设为默认

**空状态：**
- 当用户没有自定义模板时，显示空状态提示
- 提示用户创建第一个模板，或说明将使用系统默认模板

#### 5.2 创建/编辑对话框

**表单字段：**
- 模板名称输入框
  - 必填，1-50 字符
  - Placeholder: "例如：学术风格、简洁版"
- Prompt 内容文本域
  - 必填，10-3000 字符
  - 多行文本框，高度约 300px
  - Placeholder: 显示系统默认模板作为参考
- 提示文本（在文本域下方）
  - 说明可用的占位符：`{contentText}`（必需）、`{whiteboardMarkdown}`、`{languageInstruction}`
  - 说明 `{contentText}` 必须出现一次且仅一次

**按钮：**
- 保存按钮（主按钮）
- 取消按钮（次要按钮）

#### 5.3 上传对话框修改

在语言选择器下方添加 Prompt 模板选择器：

**显示逻辑：**
- 如果用户有自定义模板，显示选择器
- 如果用户没有自定义模板，不显示选择器（自动使用系统默认）

**选择器内容：**
- Label: "Prompt 模板"（i18n）
- 下拉列表显示用户的所有自定义模板
- 默认选中用户设置的默认模板
- 每个选项显示模板名称，默认模板后面显示"(默认)"标记

### 6. 错误处理

#### 6.1 验证规则

**模板名称：**
- 必填
- 长度：1-50 字符
- 同一用户下不能重复

**Prompt 内容：**
- 必填
- 长度：10-3000 字符
- 必须包含一个且仅有一个 `{contentText}` 占位符

**删除操作：**
- 删除默认模板时：
  - 如果还有其他模板，自动将最早创建的模板设为默认
  - 如果是最后一个模板，删除后自动回退到系统内置模板
- 显示确认对话框

#### 6.2 错误提示

**创建/更新失败：**
- 名称重复：显示"模板名称已存在"
- 缺少 `{contentText}`：显示"Prompt 必须包含 {contentText} 占位符"
- 多个 `{contentText}`：显示"Prompt 只能包含一个 {contentText} 占位符"
- 长度超限：显示具体的字符限制

**删除确认：**
- 删除普通模板：显示"确定要删除此模板吗？"
- 删除默认模板：显示"确定要删除默认模板吗？将自动使用系统默认模板。"

**网络错误：**
- 显示通用错误提示
- 提供重试选项

### 7. 技术实现要点

#### 7.1 后端逻辑

**获取 Prompt 模板：**
```typescript
async function getWhiteboardPrompt(
  userId: string,
  promptId?: string
): Promise<WhiteboardPrompt> {
  // 如果指定了 promptId，尝试获取该模板
  if (promptId) {
    const userPrompt = await db.query.whiteboardPrompts.findFirst({
      where: and(
        eq(whiteboardPrompts.id, promptId),
        eq(whiteboardPrompts.userId, userId)
      )
    });
    if (userPrompt) return userPrompt;
  }

  // 获取用户的默认模板
  const defaultPrompt = await db.query.whiteboardPrompts.findFirst({
    where: and(
      eq(whiteboardPrompts.userId, userId),
      eq(whiteboardPrompts.isDefault, true)
    )
  });

  // 如果没有用户模板，返回系统内置模板
  return defaultPrompt || getSystemDefaultPrompt();
}
```

**设置默认模板：**
```typescript
async function setDefaultPrompt(userId: string, promptId: string) {
  // 取消当前默认模板
  await db.update(whiteboardPrompts)
    .set({ isDefault: false })
    .where(and(
      eq(whiteboardPrompts.userId, userId),
      eq(whiteboardPrompts.isDefault, true)
    ));

  // 设置新的默认模板
  await db.update(whiteboardPrompts)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(whiteboardPrompts.id, promptId));
}
```

**删除模板：**
```typescript
async function deletePrompt(userId: string, promptId: string) {
  const prompt = await db.query.whiteboardPrompts.findFirst({
    where: and(
      eq(whiteboardPrompts.id, promptId),
      eq(whiteboardPrompts.userId, userId)
    )
  });

  if (!prompt) throw new Error('Prompt not found');

  // 删除模板
  await db.delete(whiteboardPrompts)
    .where(eq(whiteboardPrompts.id, promptId));

  // 如果删除的是默认模板，自动设置最早的模板为默认
  if (prompt.isDefault) {
    const oldestPrompt = await db.query.whiteboardPrompts.findFirst({
      where: eq(whiteboardPrompts.userId, userId),
      orderBy: asc(whiteboardPrompts.createdAt)
    });

    if (oldestPrompt) {
      await db.update(whiteboardPrompts)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(whiteboardPrompts.id, oldestPrompt.id));
    }
  }
}
```

**验证 Prompt 模板：**
```typescript
function validatePromptTemplate(template: string): {
  valid: boolean;
  error?: string
} {
  const contentTextCount = (template.match(/\{contentText\}/g) || []).length;

  if (contentTextCount === 0) {
    return {
      valid: false,
      error: m.whiteboard_prompt_validation_content_text_required()
    };
  }

  if (contentTextCount > 1) {
    return {
      valid: false,
      error: m.whiteboard_prompt_validation_content_text_once()
    };
  }

  return { valid: true };
}
```

**替换占位符：**
```typescript
function buildWhiteboardPromptFromTemplate(
  template: string,
  whiteboardMarkdown: string,
  contentText: string,
  language: "en" | "zh-cn" | "zh-tw" | "ja"
): string {
  const languageInstruction =
    language === "zh-cn"
      ? "请用简体中文生成白板图，包括所有文字、标注和说明。"
      : language === "zh-tw"
        ? "請用繁體中文生成白板圖，包括所有文字、標註和說明。"
        : language === "ja"
          ? "日本語でホワイトボード図を生成してください。すべてのテキスト、ラベル、説明を含めてください。"
          : "Generate the whiteboard in English, including all text, labels, and captions.";

  return template
    .replace(/\{whiteboardMarkdown\}/g, whiteboardMarkdown)
    .replace(/\{contentText\}/g, contentText)
    .replace(/\{languageInstruction\}/g, languageInstruction);
}
```

#### 7.2 前端集成

**修改 `upload-dialog.tsx`：**
- 添加 Prompt 模板选择器组件
- 获取用户的 prompt 模板列表
- 将选中的 `promptId` 传递给后端

**修改 `paper.ts` router：**
- 在 `create` 方法中接收 `promptId` 参数
- 将 `promptId` 传递给队列消费者

**修改 `ai.ts`：**
- 修改 `generateWhiteboardImage` 函数，接收 `promptId` 参数
- 根据 `promptId` 获取对应的模板
- 使用模板生成最终的 prompt

### 8. 国际化 (i18n)

需要在 `messages/` 目录下的各语言文件中添加以下 key：

**页面相关：**
- `whiteboard_prompt_page_title` - "白板 Prompt 管理"
- `whiteboard_prompt_page_description` - "管理您的白板图生成 Prompt 模板"
- `whiteboard_prompt_create` - "创建新模板"
- `whiteboard_prompt_empty_state` - "您还没有自定义 Prompt 模板"
- `whiteboard_prompt_empty_hint` - "创建模板以自定义白板图生成效果，或使用系统默认模板"

**表单相关：**
- `whiteboard_prompt_name` - "模板名称"
- `whiteboard_prompt_name_placeholder` - "例如：学术风格、简洁版"
- `whiteboard_prompt_content` - "Prompt 内容"
- `whiteboard_prompt_content_placeholder` - "输入您的 Prompt 模板..."
- `whiteboard_prompt_variables_hint` - "可用占位符：{contentText}（必需）、{whiteboardMarkdown}、{languageInstruction}"
- `whiteboard_prompt_content_text_required_hint` - "{contentText} 必须出现一次且仅一次"

**操作相关：**
- `whiteboard_prompt_edit` - "编辑"
- `whiteboard_prompt_delete` - "删除"
- `whiteboard_prompt_set_default` - "设为默认"
- `whiteboard_prompt_default_badge` - "默认"
- `whiteboard_prompt_system_default` - "系统默认"

**验证相关：**
- `whiteboard_prompt_validation_name_required` - "模板名称不能为空"
- `whiteboard_prompt_validation_name_length` - "模板名称长度必须在 1-50 字符之间"
- `whiteboard_prompt_validation_name_duplicate` - "模板名称已存在"
- `whiteboard_prompt_validation_content_required` - "Prompt 内容不能为空"
- `whiteboard_prompt_validation_content_length` - "Prompt 内容长度必须在 10-3000 字符之间"
- `whiteboard_prompt_validation_content_text_required` - "Prompt 必须包含 {contentText} 占位符"
- `whiteboard_prompt_validation_content_text_once` - "Prompt 只能包含一个 {contentText} 占位符"

**确认对话框：**
- `whiteboard_prompt_delete_confirm` - "确定要删除此模板吗？"
- `whiteboard_prompt_delete_default_confirm` - "确定要删除默认模板吗？将自动使用系统默认模板。"
- `whiteboard_prompt_delete_success` - "模板已删除"

**上传对话框：**
- `upload_select_prompt_template` - "Prompt 模板"

### 9. 测试计划

#### 9.1 单元测试

- 测试 `validatePromptTemplate` 函数
- 测试 `buildWhiteboardPromptFromTemplate` 函数
- 测试 `getWhiteboardPrompt` 函数的各种场景

#### 9.2 集成测试

- 测试创建、更新、删除 prompt 模板的完整流程
- 测试设置默认模板的逻辑
- 测试删除默认模板后的自动回退逻辑
- 测试上传论文时使用自定义 prompt 的流程

#### 9.3 用户测试场景

1. 用户首次访问 prompt 管理页面（空状态）
2. 用户创建第一个 prompt 模板（自动设为默认）
3. 用户创建多个 prompt 模板并切换默认模板
4. 用户编辑 prompt 模板内容
5. 用户删除非默认模板
6. 用户删除默认模板（验证自动回退逻辑）
7. 用户删除所有模板后上传论文（验证使用系统默认）
8. 用户在上传对话框中选择不同的 prompt 模板

### 10. 实施计划

#### 阶段 1：数据库和后端 API
1. 创建数据库迁移文件
2. 在 `schema.ts` 中定义 `whiteboardPrompts` 表
3. 创建 `whiteboard-prompt.ts` tRPC router
4. 实现 CRUD 操作和验证逻辑

#### 阶段 2：Prompt 管理页面
1. 创建 `/whiteboard-prompts` 路由
2. 实现模板列表展示
3. 实现创建/编辑对话框
4. 实现删除确认对话框
5. 添加 i18n 翻译

#### 阶段 3：上传对话框集成
1. 在上传对话框中添加 prompt 模板选择器
2. 修改上传逻辑，传递 `promptId`
3. 测试完整的上传流程

#### 阶段 4：白板图生成集成
1. 修改 `ai.ts` 中的相关函数
2. 实现 prompt 模板的获取和占位符替换
3. 测试白板图生成效果

#### 阶段 5：测试和优化
1. 执行单元测试和集成测试
2. 进行用户测试
3. 修复 bug 和优化用户体验

## 总结

本设计方案提供了一个完整的白板 Prompt 自定义管理功能，允许用户创建和管理多个 prompt 模板，并在上传论文时灵活选择使用。系统内置模板作为默认选项，确保用户在没有自定义模板时也能正常使用。整个设计遵循现有的架构模式，与 API 配置管理功能保持一致的用户体验。

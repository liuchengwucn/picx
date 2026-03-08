# BYOK (Bring Your Own Key) API 配置功能设计文档

## 概述

允许用户提供自己的 API key（OpenAI 和 Gemini），在生成论文摘要和白板图时使用用户的 API，从而不消耗系统 credits。

## 需求

1. 用户可以在设置页面配置自己的 API keys（OpenAI + Gemini）
2. 配置包含完整的 API 信息：API key、base URL、model
3. 用户必须提供所有必需字段才能使用自己的 API（不消耗 credit）
4. 上传论文时可以选择使用系统 API（消耗 credit）或用户 API（不消耗 credit）
5. 提供 API 测试功能，验证配置是否正确
6. API key 安全存储在数据库中（加密）

## 数据库设计

### 新增表：user_api_configs

```sql
CREATE TABLE user_api_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  openai_api_key TEXT NOT NULL,
  openai_base_url TEXT NOT NULL,
  openai_model TEXT NOT NULL,
  gemini_api_key TEXT NOT NULL,
  gemini_base_url TEXT NOT NULL,
  gemini_model TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  last_tested_at INTEGER,
  openai_test_status TEXT DEFAULT 'untested',
  gemini_test_status TEXT DEFAULT 'untested',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_user_api_configs_user_id ON user_api_configs(user_id);
CREATE INDEX idx_user_api_configs_user_default ON user_api_configs(user_id, is_default);
```

**字段说明：**
- `id`: UUID 主键
- `user_id`: 用户 ID
- `name`: 配置名称（用户自定义）
- `openai_api_key`: OpenAI API key（AES-256 加密存储）
- `openai_base_url`: OpenAI API 端点
- `openai_model`: OpenAI 模型名称
- `gemini_api_key`: Gemini API key（AES-256 加密存储）
- `gemini_base_url`: Gemini API 端点
- `gemini_model`: Gemini 模型名称
- `is_default`: 是否为默认配置（每个用户只能有一个）
- `last_tested_at`: 最后测试时间
- `openai_test_status`: OpenAI 测试状态（success/failed/untested）
- `gemini_test_status`: Gemini 测试状态（success/failed/untested）

**验证规则：**
- 所有 API 配置字段（key、base_url、model）都必填
- 每个用户只能有一个 `is_default = true` 的配置
- API key 在存储前必须加密

## API 设计（tRPC）

### 新增 Router：apiConfigRouter

**1. create - 创建配置**
```typescript
input: {
  name: string (1-100 字符)
  openaiApiKey: string (必填)
  openaiBaseUrl: string (URL 格式)
  openaiModel: string (必填)
  geminiApiKey: string (必填)
  geminiBaseUrl: string (URL 格式)
  geminiModel: string (必填)
  isDefault?: boolean
}
output: { id: string }
```

**2. list - 列出配置**
```typescript
output: Array<{
  id: string
  name: string
  openaiApiKey: string (脱敏)
  openaiBaseUrl: string
  openaiModel: string
  geminiApiKey: string (脱敏)
  geminiBaseUrl: string
  geminiModel: string
  isDefault: boolean
  lastTestedAt: Date | null
  openaiTestStatus: 'success' | 'failed' | 'untested'
  geminiTestStatus: 'success' | 'failed' | 'untested'
  createdAt: Date
}>
```

**3. getById - 获取单个配置**
```typescript
input: string (UUID)
output: 同 list 中的单个对象
```

**4. update - 更新配置**
```typescript
input: {
  id: string (UUID)
  name?: string
  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiModel?: string
  geminiApiKey?: string
  geminiBaseUrl?: string
  geminiModel?: string
  isDefault?: boolean
}
output: { success: boolean }
```

**5. delete - 删除配置**
```typescript
input: string (UUID)
output: { success: boolean }
```

**6. test - 测试配置**
```typescript
input: {
  id?: string (测试已保存的配置)
  // 或提供临时配置
  openaiApiKey?: string
  openaiBaseUrl?: string
  openaiModel?: string
  geminiApiKey?: string
  geminiBaseUrl?: string
  geminiModel?: string
}
output: {
  openaiStatus: 'success' | 'failed'
  geminiStatus: 'success' | 'failed'
  errors?: {
    openai?: string
    gemini?: string
  }
}
```

### 修改现有 API：paper.create

添加可选参数：
```typescript
input: {
  // ... 现有字段
  apiConfigId?: string (UUID)
}
```

**逻辑变更：**
- 如果提供 `apiConfigId`：使用用户 API 配置，**不扣除 credit**
- 如果不提供：使用系统 API 配置，**扣除 1 credit**

## UI 设计

### 1. 设置页面（/settings/api-configs）

**功能：**
- 显示用户的所有 API 配置列表
- 每个配置卡片显示：
  - 配置名称
  - OpenAI 和 Gemini 的脱敏 API key
  - 测试状态（✓ 已测试 / ⚠ 未测试 / ✗ 测试失败）
  - 是否为默认配置
  - 创建时间
  - 操作按钮：测试、编辑、删除
- [+ 新建配置] 按钮

### 2. 配置编辑对话框

**字段：**
- 配置名称（文本输入）
- OpenAI 配置组：
  - API Key（密码输入框）
  - Base URL（文本输入，默认：https://api.openai.com/v1）
  - Model（文本输入，默认：gpt-4o）
- Gemini 配置组：
  - API Key（密码输入框）
  - Base URL（文本输入，默认：https://generativelanguage.googleapis.com/v1beta）
  - Model（文本输入，默认：gemini-2.0-flash-exp）
- 设为默认配置（复选框）

**按钮：**
- [测试连接] - 测试两个 API 是否可用
- [保存] - 保存配置
- [取消] - 关闭对话框

### 3. 上传对话框修改

添加 API 配置选择区域：
```
API 配置:
○ 使用系统 API（消耗 1 credit）
● 使用我的 API（不消耗 credit）
  └─ [配置选择下拉框]
```

**逻辑：**
- 如果用户没有配置，只显示"使用系统 API"
- 如果用户有配置，默认选中默认配置
- 如果选择"使用我的 API"但没有配置，提示跳转到设置页面

## 数据流

### 1. 上传论文流程

```
用户上传论文
    ↓
选择 API 配置？
    ├─ 否 → 使用系统 API → 扣除 1 credit → 推送到队列
    └─ 是 → 使用用户 API → 不扣 credit → 推送到队列（带 apiConfigId）
                                                    ↓
                                            队列 Worker 处理
                                                    ↓
                                        从数据库读取并解密配置
                                                    ↓
                                            传递给 AI 函数
                                                    ↓
                                            生成摘要和白板图
```

### 2. 测试连接流程

```
用户点击测试
    ↓
发送测试请求到后端
    ↓
后端并行测试 OpenAI 和 Gemini
    ├─ OpenAI: 发送简单的 completion 请求（max_tokens=5）
    └─ Gemini: 发送简单的 generateContent 请求
    ↓
返回测试结果
    ↓
更新数据库中的测试状态和时间
    ↓
前端显示测试结果
```

## 安全设计

### 1. API Key 加密

**加密算法：** AES-256-GCM

**实现：**
```typescript
// src/lib/crypto.ts
export function encrypt(plaintext: string, secret: string): string {
  // 使用 Web Crypto API
  // 生成随机 IV
  // 加密数据
  // 返回格式：iv:authTag:ciphertext (Base64)
}

export function decrypt(ciphertext: string, secret: string): string {
  // 解析 iv:authTag:ciphertext
  // 解密数据
  // 返回明文
}

export function maskApiKey(apiKey: string): string {
  // 返回格式：sk-...abc123
  // 显示前 3 字符 + "..." + 后 6 字符
}
```

**环境变量：**
- `API_KEY_ENCRYPTION_SECRET`: 加密密钥（至少 32 字节）

### 2. 前端安全

- API key 输入框使用 `type="password"`
- 列表和详情只显示脱敏的 key
- 编辑时不回显完整 key，只能重新输入
- 所有 API 操作需要用户认证
- 用户只能访问自己的配置

### 3. 后端验证

- 所有操作验证用户身份
- 创建/更新时验证所有必填字段
- 删除时检查是否有正在使用的论文
- 设置默认配置时自动取消其他配置的默认状态

## 错误处理

### 1. 用户 API 配置错误

**场景：** 用户的 API key 无效或配额不足

**处理：**
- 论文状态标记为 `failed`
- 错误信息明确指出是用户 API 的问题
- 不退还 credit（因为没有扣除）
- 建议用户检查 API 配置或切换到系统 API

### 2. 系统 API 错误

**处理：**
- 按现有逻辑处理
- 考虑是否退还 credit（可选）

### 3. 测试失败

**处理：**
- 显示具体错误信息（API 返回的错误）
- 更新测试状态为 `failed`
- 提供重试按钮

## 性能优化

### 1. 缓存策略

- 用户配置列表使用 TanStack Query 缓存（5 分钟）
- 测试结果缓存在数据库中

### 2. 队列处理

- 队列消息中只传递 `apiConfigId`，不传递完整配置
- Worker 从数据库读取并解密配置
- 失败重试时重新读取配置（防止配置已更新）

## 实现计划

### Phase 1: 数据库和加密
1. 创建数据库 migration
2. 实现加密/解密工具函数
3. 添加环境变量配置

### Phase 2: 后端 API
1. 实现 apiConfigRouter（CRUD + test）
2. 修改 paper.create 支持 apiConfigId
3. 修改队列 Worker 支持用户配置

### Phase 3: 前端 UI
1. 创建设置页面和配置管理界面
2. 实现配置编辑对话框
3. 修改上传对话框添加配置选择

### Phase 4: 测试和优化
1. 测试加密/解密功能
2. 测试 API 配置的完整流程
3. 测试错误处理和边界情况
4. 性能优化和用户体验改进

## 默认值

**OpenAI 默认配置：**
- Base URL: `https://api.openai.com/v1`
- Model: `gpt-4o-mini`

**Gemini 默认配置：**
- Base URL: `https://generativelanguage.googleapis.com/v1beta`
- Model: `gemini-3.1-flash-image-preview`

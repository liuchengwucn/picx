import type { SkillInput } from "#/lib/skills";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** 导入对话框解析出的草稿，送给新建技能页 */
    skillDraft?: SkillInput;
    /** 技能编辑页「用它开一段对话」带去助手页的技能名 */
    pendingSkillName?: string;
  }
}

// 纯类型增强，没有运行时导出；空 export 让它保持为一个模块
export {};

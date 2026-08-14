import { m } from "#/paraglide/messages";

/** tRPC 错误码 → 页面文案。四条之外一律走通用兜底 */
export function resolveSkillErrorMessage(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  switch (code) {
    case "CONFLICT":
      return m.assistant_skills_error_conflict();
    case "PRECONDITION_FAILED":
      return m.assistant_skills_error_limit();
    case "FORBIDDEN":
      return m.assistant_skills_error_readonly();
    default:
      return m.assistant_skills_error_generic();
  }
}

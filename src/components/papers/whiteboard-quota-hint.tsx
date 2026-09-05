import { Link } from "@tanstack/react-router";
import { m } from "#/paraglide/messages";

export interface WhiteboardQuotaHintProps {
  /** 还能生成几张（= profile.credits，1 分 = 1 张；这个换算只在这里出现） */
  remaining: number;
  apiSource: "system" | "user";
  hasApiConfigs: boolean;
  /** 用完时点「用我的 API」：父级把 apiSource 切到 user 并选中默认配置 */
  onUseOwnApi?: () => void;
  /**
   * 额度还没查回来**或查失败**——两者都是「不知道还剩几张」。
   * 父级必须同时把控件当作「未用完」，别只喂这个标志。
   */
  loading?: boolean;
  /** 挂到被禁用的开关 / 按钮的 aria-describedby 上 */
  id?: string;
}

/**
 * 积分在整个站点唯一允许露面的地方——而且只以「张数」露面，从不出现「积分」二字，
 * 也不写每日 +3、不写上限 20（写出来就是在引入新概念）。
 *
 * 四个分支：用自己的 API / 还有额度 / 用完且有配置（可一键切换）/ 用完且没配置（去设置）。
 */
export function WhiteboardQuotaHint({
  remaining,
  apiSource,
  hasApiConfigs,
  onUseOwnApi,
  loading,
  id,
}: WhiteboardQuotaHintProps) {
  // 额度还没查回来时什么都不说——这不是疏漏，是刻意的。remaining 此刻是 0，
  // 而「还没查到」和「真的用完了」在数值上无从分辨，照常渲染就会给一个额度
  // 充足的用户弹出「今天的额度用完了」并顺手禁用开关，正是本次改版要消灭的
  // 那种焦虑。配套要求：父级把 loading 一并当作「未用完」，让控件保持可用。
  // 万一额度真的是空的，服务端还会回 INSUFFICIENT_CREDITS，而那个码已经映射到
  // 同一句额度文案——最坏情况只是真话晚到一步，而不是假话立刻挡住用户。
  if (loading) return null;
  if (apiSource === "user") {
    return (
      <p id={id} className="text-xs text-[var(--ink-soft)]">
        {m.whiteboard_quota_own_api()}
      </p>
    );
  }
  if (remaining >= 1) {
    return (
      <p id={id} className="text-xs text-[var(--ink-soft)]">
        {m.whiteboard_quota_remaining({ count: String(remaining) })}
      </p>
    );
  }
  return (
    <p id={id} className="text-xs text-[var(--ink-soft)]">
      {m.whiteboard_quota_exhausted()}{" "}
      {hasApiConfigs ? (
        <button
          type="button"
          onClick={onUseOwnApi}
          className="text-[var(--academic-brown)] underline underline-offset-2"
        >
          {m.whiteboard_quota_use_own_api()}
        </button>
      ) : (
        // 颜色挂在内层 span：styles.css 里未分层的 a{color} 会静默盖掉 <Link> 上的 text-*
        <Link to="/settings/providers" className="underline underline-offset-2">
          <span className="text-[var(--academic-brown)]">
            {m.whiteboard_quota_configure_api()}
          </span>
        </Link>
      )}
    </p>
  );
}

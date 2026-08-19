import { AlertTriangle, ArrowRight, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { m } from "#/paraglide/messages";

/**
 * 全站三态口径里的两个面板。第三态「骨架」不在这里: 骨架必须贴各页自己的真实排版
 * (通用灰条块只会让读者以为页面坏了), 所以由各页自带。
 *
 * - PendingPanel    虚线边 = 内容还没生成
 * - LoadFailedPanel 实线边 + 重试按钮 = 内容该有, 只是这次没取到
 *
 * 为什么是两个组件而不是一个带 variant 的面板: 调用点写哪个组件名就是在声明「这是
 * 哪一种状态」, 传错了 code review 看得见; variant 字符串会在复制粘贴里静默漂移。
 * 把读失败说成「生成中」等于对用户撒谎, 而失败态没有可点的东西等于把唯一有用的
 * 动作藏起来 —— 所以 onRetry 是必填而不是可选。
 */
export function LoadFailedPanel({
  message,
  onRetry,
}: {
  /** 缺省是画廊通用文案; 各页有更准的说法时传进来 */
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="rise-in mx-auto max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-6 py-12 text-center shadow-[0_4px_16px_rgba(45,42,36,0.06)]">
      <div className="mb-5 flex justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--parchment-warm)]">
          <AlertTriangle
            className="h-7 w-7 text-[var(--academic-brown)]"
            strokeWidth={1.25}
            aria-hidden
          />
        </div>
      </div>
      <p className="mb-6 text-base text-[var(--ink-soft)]">
        {message ?? m.gallery_load_failed()}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-6 py-3 text-sm font-semibold text-[var(--ink)] shadow-[0_2px_8px_rgba(45,42,36,0.06)] transition-all hover:-translate-y-0.5 hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]"
      >
        <RotateCcw className="h-4 w-4" strokeWidth={1.25} aria-hidden />
        {m.gallery_retry()}
      </button>
    </div>
  );
}

/**
 * 「内容还没生成」。虚线边是这一态唯一的视觉标记 —— 不给图标块、不给按钮: 读者
 * 做不了任何事让它更快生成, 放一个假动作按钮只会骗人点。
 *
 * action 是可选的「同时还能去哪」出口(空屏必须给一个去处, 否则就是死胡同)。
 * 收成 ReactNode 而不是 `{ to, label }`: TanStack 的 Link 靠 to 的**字面量**做类型推断,
 * 面板一旦替调用方拼 Link, to 就得在这里穷举所有目标(方向页那种带 params 的目标连
 * 联合类型都过不了), 于是一个通用状态面板被钉在了具体路由表上。让调用方自己传
 * <Link> 进来, 面板只保留「声明你处在哪一种状态」这份价值。
 */
export function PendingPanel({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="rise-in mx-auto max-w-md rounded-2xl border border-dashed border-[var(--line)] px-6 py-14 text-center">
      <p className="text-base text-[var(--ink-soft)]">{message}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * 面板态里那条「去别处」的链接。样式集中在这里, 免得每个调用方各写一份箭头 + 间距。
 *
 * 不写 text-[var(--academic-brown)]: styles.css 里那条未分层的 `a { color }` 压过
 * Tailwind utilities 层, 写在 <a> 上的 text-* 是死类 —— 而全局 a{} 给的正好就是这个色。
 * 要改色只能挂到内层 <span> 上。
 */
export function PanelLinkContent({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ArrowRight
        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
        strokeWidth={1.25}
        aria-hidden
      />
    </>
  );
}

/** 面板里链接的 className: 与 PanelLinkContent 配对使用(group 是箭头位移的锚) */
export const panelLinkClass =
  "group inline-flex items-center gap-1 text-sm font-semibold no-underline";

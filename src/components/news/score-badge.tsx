// 低分阈值：低于此值提示可能有聚类混入。对应管线里的入库门槛
// RELEVANCE_THRESHOLD（定义见 src/workers/news-cron.ts，以该处为准），这里不直接 import
// 那个文件——避免把 worker 代码打进客户端 bundle，只是数值上保持关联参考。
// 取门槛下一档（2026-08-15 随门槛 65→55 一起下调，否则整个 55 档都会标黄）
const LOW_SCORE_HIGHLIGHT = 50;

interface ScoreBadgeProps {
  min: number;
  max?: number | null;
}

// 调试徽标：relevance 分数（单值或 story 内 min-max 范围），低分暴露聚类混入
export function ScoreBadge({ min, max }: ScoreBadgeProps) {
  const label = max == null || max === min ? min : `${min}–${max}`;
  return (
    <span
      className={`rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 font-mono text-[11px] ${
        min < LOW_SCORE_HIGHLIGHT
          ? "text-amber-600 dark:text-amber-500"
          : "text-[var(--ink-soft)]"
      }`}
    >
      {label}
    </span>
  );
}

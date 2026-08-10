import { Link } from "@tanstack/react-router";
import {
  type FeedbackAuthState,
  FeedbackButtons,
} from "#/components/papers/feedback-buttons";
import { m } from "#/paraglide/messages";

export interface DigestPaperCardPaper {
  id: string;
  /** 白板管线未跑完的入选论文没有 shortId 落点, 此时标题不可点 */
  shortId: string | null;
  title: string;
  tldr: string;
  /** 兜底发布的期可能有无图论文, 此时降级为纯文字卡 */
  whiteboardImageR2Key: string | null;
  recommendationNote: string;
  /** 编辑排序(1 起)。父级是 <ol>, 数字只做视觉标记, 对读屏隐藏 */
  rank: number;
  likeCount: number;
}

interface DigestPaperCardProps {
  paper: DigestPaperCardPaper;
  myVote?: 1 | -1;
  auth: FeedbackAuthState;
  signInCallbackURL: string;
}

/**
 * 简报期内的一篇入选论文。布局照 GalleryCard(图左文右)但刻意不做成整卡链接:
 * 卡内有常驻的赞/踩按钮和推荐语, 套在 <a> 里既是非法 HTML 也会让每次投票都触发跳转,
 * 所以只有标题(和纯装饰的缩略图)是链接。
 *
 * 反馈按钮常驻而不是像 gallery 卡那样 hover 浮现: 简报是编辑推荐, 「这篇合不合口味」
 * 就是本页要收的一等信号, 而且移动端没有 hover 可用。
 */
export function DigestPaperCard({
  paper,
  myVote,
  auth,
  signInCallbackURL,
}: DigestPaperCardProps) {
  const { shortId } = paper;

  return (
    <li className="list-none">
      <article className="flex overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_4px_16px_rgba(45,42,36,0.08)] transition-shadow hover:shadow-[0_12px_32px_rgba(139,111,71,0.16)]">
        {/* 缩略图锚顶: 白板左上角是论文标题, 缩到小尺寸时要留住它。整块只是标题链接的
            放大点击区, 读屏里跳过(标题那条已经念过同一个目的地)。 */}
        {paper.whiteboardImageR2Key ? (
          <div className="relative w-28 shrink-0 overflow-hidden bg-[var(--parchment-warm)] sm:w-40">
            {shortId ? (
              <Link
                to="/p/$shortId"
                params={{ shortId }}
                tabIndex={-1}
                aria-hidden="true"
                className="absolute inset-0 block"
              >
                <Thumbnail r2Key={paper.whiteboardImageR2Key} />
              </Link>
            ) : (
              <Thumbnail r2Key={paper.whiteboardImageR2Key} />
            )}
            <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-[var(--surface-strong)] opacity-60" />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 sm:p-5">
          <div className="flex items-baseline gap-2.5">
            <span
              aria-hidden="true"
              className="shrink-0 font-serif text-base font-bold tabular-nums text-[var(--academic-brown)]/70"
            >
              {paper.rank}
            </span>
            <h3 className="min-w-0 font-serif text-lg font-semibold leading-snug text-[var(--ink)] sm:text-xl">
              {shortId ? (
                <Link
                  to="/p/$shortId"
                  params={{ shortId }}
                  className="no-underline transition-colors hover:text-[var(--academic-brown)]"
                >
                  {paper.title}
                </Link>
              ) : (
                paper.title
              )}
            </h3>
          </div>

          {paper.tldr ? (
            <p className="line-clamp-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              {paper.tldr}
            </p>
          ) : null}

          {/* 推荐语是这一页的主角: 金色左线 + 斜体, 与上面机器生成的 tldr 分开, 读者
              一眼看得出哪句是「编辑为什么选它」。 */}
          {paper.recommendationNote ? (
            <div className="border-l-2 border-[var(--academic-brown)] pl-3">
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--academic-brown)]">
                {m.digest_editor_note()}
              </span>
              <p className="mt-1 text-sm italic leading-relaxed text-[var(--ink)]">
                {paper.recommendationNote}
              </p>
            </div>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-1">
            <FeedbackButtons
              paperId={paper.id}
              likeCount={paper.likeCount}
              myVote={myVote}
              auth={auth}
              signInCallbackURL={signInCallbackURL}
              variant="card"
              // 赞数由右边那句常驻文本负责: 放进按钮里会在 session 解析完成前(auth
              // 为 pending, 按钮整个不渲染)连数字一起消失
              showCount={false}
            />
            {paper.likeCount > 0 ? (
              <span className="text-xs tabular-nums text-[var(--ink-soft)]">
                {m.feedback_like_count({ count: String(paper.likeCount) })}
              </span>
            ) : null}
          </div>
        </div>
      </article>
    </li>
  );
}

/** alt 留空: 标题就在旁边, 缩略图在这里纯装饰, 念一遍论文标题只是噪音。 */
function Thumbnail({ r2Key }: { r2Key: string }) {
  return (
    <img
      src={`/api/r2/${r2Key}`}
      alt=""
      loading="lazy"
      className="absolute inset-0 h-full w-full object-cover object-top"
    />
  );
}

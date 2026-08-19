import { Link } from "@tanstack/react-router";
import { SelfHidingImage } from "#/components/self-hiding-image";

export interface EditionPickView {
  id: string;
  shortId: string | null;
  title: string;
  recommendationNote: string;
  whiteboardImageR2Key: string | null;
  rank: number;
}

/**
 * 合刊栏目里的一条 picks。
 *
 * 只有栏目头条(第一条)配白板缩略图 —— 一屏 7 个栏目, 每条都配图会读成商品列表,
 * 而「有图 = rank 1」让视觉重量表达真实的编辑排序。
 * 白板管线是异步的, 兜底发布的期必然有无图论文: 无图就降级成文字条目, 不留空框。
 *
 * 正文是 recommendationNote(这一期的编辑判断「新在哪」)而不是 tldr(论文讲了什么)。
 * 合刊内不放赞/踩: 投票动作留在方向页论文流与论文详情页。
 */
export function PickEntry({
  pick,
  lead,
}: {
  pick: EditionPickView;
  lead: boolean;
}) {
  const body = (
    <span className="block min-w-0">
      <span className="block text-[13.5px] font-semibold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown-deep)]">
        {pick.title}
      </span>
      {pick.recommendationNote ? (
        <span className="mt-1 block text-xs leading-relaxed text-[var(--ink-soft)]">
          {pick.recommendationNote}
        </span>
      ) : null}
    </span>
  );

  const inner =
    lead && pick.whiteboardImageR2Key ? (
      <span className="flex items-start gap-3">
        <PickThumb r2Key={pick.whiteboardImageR2Key} />
        {body}
      </span>
    ) : (
      body
    );

  // shortId 缺失(理论上不会, 但列表要求完整)时退化为不可点条目, 不生成死链
  if (!pick.shortId) {
    return <li className="border-t border-[var(--line)] py-2.5">{inner}</li>;
  }
  return (
    <li className="border-t border-[var(--line)]">
      <Link
        to="/p/$shortId"
        params={{ shortId: pick.shortId }}
        className="group block py-2.5 no-underline"
      >
        {inner}
      </Link>
    </li>
  );
}

/**
 * 缩略图。白板 key 存在但对象已不在 R2(迁移 / 清理 / 管线中途失败)时, 留一个坏图
 * 框比无图更难看 —— 取不到就整个 <img> 消失(连带 flex 间距), 条目自动退化成纯
 * 文字条。这套「自隐藏」的实现与其中的 hydration 竞态全在 SelfHidingImage 里,
 * 别在这里再抄一份(曾经抄过, 抄丢了渲染期重置那一行)。
 */
function PickThumb({ r2Key }: { r2Key: string }) {
  return (
    <SelfHidingImage
      src={`/api/r2/${r2Key}`}
      // alt 留空: 标题就在旁边, 缩略图在这里纯装饰, 念一遍论文标题只是噪音
      alt=""
      className="w-[118px] shrink-0 rounded-md border border-[var(--line)] bg-[var(--parchment-warm)] object-cover object-left-top"
      // 白板左上角是论文标题, 缩到 118px 要留住它 —— 与 digest-paper-card 同口径
      style={{ aspectRatio: "3 / 2" }}
    />
  );
}

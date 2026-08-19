import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";

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
 * 缩略图。取不到图时整个 <img> 消失(连带 flex 间距), 条目自动退化成纯文字条 ——
 * 白板 key 存在但对象已不在 R2(迁移/清理/管线中途失败)时留一个坏图框比无图更难看。
 *
 * 只挂 onError 不够: 合刊页是 SSR 直出, 浏览器解析到 <img> 就开始下载, 而 React
 * 的 onError 要等 bundle 到达、hydration 跑到这个节点才挂上; 图片的错误若早于
 * hydration 返回, error 事件就永久丢失, 框子再也摘不掉(news 的 StoryImage 为此
 * 做过本地实测: JS 延迟 4s 时坏图框稳定留在页面上)。所以挂载时必须主动补检
 * `complete && naturalWidth === 0`(语义 = 加载已结束却没有任何像素)。
 * ref callback 跑在 commit 阶段、早于绘制, 因此不会闪一帧坏图。
 */
function PickThumb({ r2Key }: { r2Key: string }) {
  // 记「哪个 key 失败了」而不是裸布尔: 同一实例换图时失败态要自动作废(照抄
  // StoryImage 的口径, 别退化成需要调用方挂 key 的写法)
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const probeOnMount = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth === 0) setFailedKey(r2Key);
    },
    [r2Key],
  );
  if (failedKey === r2Key) return null;
  return (
    <img
      ref={probeOnMount}
      // alt 留空: 标题就在旁边, 缩略图在这里纯装饰, 念一遍论文标题只是噪音
      src={`/api/r2/${r2Key}`}
      alt=""
      loading="lazy"
      onError={() => setFailedKey(r2Key)}
      className="w-[118px] shrink-0 rounded-md border border-[var(--line)] bg-[var(--parchment-warm)] object-cover object-left-top"
      // 白板左上角是论文标题, 缩到 118px 要留住它 —— 与 digest-paper-card 同口径
      style={{ aspectRatio: "3 / 2" }}
    />
  );
}

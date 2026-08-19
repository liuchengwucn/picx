/**
 * 方向识别色：12 级受限暖色弧（20° 沙土 – 140° 深橄榄）。
 *
 * 为什么不按方向数均分色环：颜色一旦被读者学会（「橄榄绿 = 预训练数据」）就是身份，
 * 而均分会让「新增一个方向」把所有老方向的颜色洗掉。所以固定 12 个槽位 +
 * hash(slug) 落位 + 按 createdAt 先到先得，新方向只能拿空槽。
 *
 * 色只出现在栏眉 7px 方块与脊上 2px 高亮边线（合计 <1% 面积）。文字恒为
 * --ink / --ink-soft —— 别把这里的色传给 color。
 */
const HUE_START = 20;
/**
 * 开区间上界, 取不到。步长 = (HUE_END - HUE_START) / ACCENT_SLOTS = 10°, 所以
 * 实际用到的最大色相是 130°(第 12 个槽位), 140 只是用来定步长的除数。
 */
const HUE_END = 140;
export const ACCENT_SLOTS = 12;
/**
 * 槽位 → 色相的跳步。**必须与 ACCENT_SLOTS 互素**, 否则 hueOfSlot 不再是双射,
 * 会有两个方向拿到同一个色相(direction-color.test.ts 的双射用例会变红)。
 * 放在 ACCENT_SLOTS 旁边就是为了让这条约束的两个操作数挨着, 改一个能看见另一个。
 */
const HUE_JUMP = 5;

/**
 * FNV-1a 32 位。必须是显式实现的确定性哈希：SSR 与客户端要算出同一个槽位，
 * 否则栏眉方块颜色就是一处 hydration mismatch（而 #418 在压缩构建里只报编号，
 * 极难定位）。Math.imul 保证 32 位回绕与 C 实现一致。
 */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface DirectionColorInput {
  slug: string;
  /** 先到先得的排序键。epoch ms 或 Date 都收（tRPC 序列化后可能是任一种） */
  createdAt: Date | number | string;
}

function toMs(v: Date | number | string): number {
  return typeof v === "number" ? v : new Date(v).getTime();
}

/** slug → 色相角。输入顺序无关：内部按 createdAt 定序，结果确定。 */
export function assignDirectionHues(
  dirs: readonly DirectionColorInput[],
): Map<string, number> {
  const ordered = [...dirs].sort(
    // createdAt 并列（同一次 seed 批量插入）时按 slug 定序，否则结果取决于
    // 数组顺序，SSR 与客户端可能不同
    (a, b) =>
      toMs(a.createdAt) - toMs(b.createdAt) || a.slug.localeCompare(b.slug),
  );
  const taken = new Set<number>();
  const hues = new Map<string, number>();
  for (const d of ordered) {
    let slot = fnv1a32(d.slug) % ACCENT_SLOTS;
    // 槽位全满（方向数 > 12）之后不再顺延，直接复用哈希槽：那时颜色不再是唯一
    // 识别手段，旁边始终有方向名。
    if (taken.size < ACCENT_SLOTS) {
      while (taken.has(slot)) slot = (slot + 1) % ACCENT_SLOTS;
    }
    taken.add(slot);
    hues.set(d.slug, hueOfSlot(slot));
  }
  return hues;
}

/**
 * 槽位 → 色相角。刻意不是 `20 + slot * 10` 的顺序排列，而是按 HUE_JUMP 跳着取
 * （与 ACCENT_SLOTS 互素，所以仍是双射，12 个槽位一个不漏、一色不重）。
 *
 * 为什么：顺延让位会让「哈希撞在一起」的方向拿到相邻槽位，而顺序排列下相邻槽位
 * 只差 10°——本地七方向夹具实测就撞出了 50°/60°/70° 三个方向，7px 方块放大四倍
 * 看都是同一块铁锈色。跳着取之后这三个方向落到 50°/100°/30°，一眼可分。
 *
 * 这只改「第几个槽位对应哪个色相」，不改落位与让位规则，所以「新增方向不洗牌」
 * 那条不变式照旧成立（它只依赖槽位分配，而槽位分配没动）。
 */
function hueOfSlot(slot: number): number {
  const step = (HUE_END - HUE_START) / ACCENT_SLOTS;
  return HUE_START + ((slot * HUE_JUMP) % ACCENT_SLOTS) * step;
}

/**
 * 色相角 → CSS 颜色。L/C 走 CSS 变量，所以同一个字符串在亮暗两套主题下
 * 自动取不同明度（token 定义见 styles.css 的 --accent-l / --accent-c）。
 */
export function directionAccent(hue: number): string {
  return `oklch(var(--accent-l) var(--accent-c) ${hue.toFixed(1)})`;
}

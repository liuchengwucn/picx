import { useMatchRoute } from "@tanstack/react-router";

/**
 * 「是否身处 gallery 这个分区」——顶栏(Header)与底栏(MobileTabBar)的「画廊」项
 * 共用同一条产品规则, 抽到这里而不是各写一份, 是因为它必须两处同步: 将来 gallery
 * 下再加子路由(比如方向页重写可能引入新子路径), 两处若各自维护前缀, 忘改一处就是
 * 显式的行为分裂——顶栏亮而底栏不亮, 或反之。
 *
 * 与「这就是当前这一页」(aria-current, 由调用方的 Link 自己配 `activeOptions:
 * {exact:true}` 精确判定)刻意不同源: 分区(用本 hook, 前缀匹配)与分区内当前项
 * (方向 tab 等, 精确匹配)是同一层级树的两级, 不是互斥的两个身份——顶栏亮"画廊" +
 * 页面自己的方向 tab 亮当前方向, 用户才知道"我在哪个分区、分区里又在哪一项"。若把
 * 这两件事按同一个判据算, 要么分区高亮在子页面上全灭(用户失去方位感), 要么
 * aria-current 在多个层级上重复出现(读屏一次念出两个"当前页")。
 *
 * TanStack 的 `activeProps` 把 className 与 isActive(进而与 aria-current)绑在
 * 一起, 没法只驱动其中一半, 所以这里绕开它, 调用方自己拼 className。
 */
export function useInGallerySection(): boolean {
  const matchRoute = useMatchRoute();
  return Boolean(matchRoute({ to: "/gallery", fuzzy: true }));
}

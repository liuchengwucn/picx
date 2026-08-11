import { adminProcedure, router } from "../init";

export const adminRouter = router({
  /** 管理页 mount 时的权限探针：能调通即 admin，403/401 由前端渲染 404 态 */
  whoami: adminProcedure.query(({ ctx }) => ({ userId: ctx.session.user.id })),
});

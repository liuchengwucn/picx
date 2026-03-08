import { createAuthClient } from "better-auth/react";

// 在浏览器环境中，baseURL 应该指向当前域名
// 开发环境下默认是 http://localhost:3000
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
});

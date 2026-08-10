/**
 * 把 pdfjs-dist 的四个运行时资源目录拷进 public/pdfjs/。
 *
 * 挂在 postinstall 和 build 两处，是因为两条路径各自都有缺口：只有 postinstall 的话，
 * 任何用 --ignore-scripts 的部署路径都会让 public/pdfjs/ 静默消失——构建不报错，
 * 运行时也没有错误态（hook 的 status 仍是 "ready"），线上中日文 PDF 直接一片空白
 * 而本地一切正常，是最难查的那类问题；只有 build 的话，`npx vite dev` 这种绕过
 * npm scripts 的常见起法又拿不到资源。脚本幂等，跑两次的代价见下面的版本戳。
 *
 * 为什么必须拷：pdf.js 不把 cmaps / 标准字体 / wasm / ICC 打进 bundle，而是运行时
 * 按 `${cMapUrl}${name}.bcmap` 这样拼 URL 去 fetch（见 pdf.mjs 的 BaseBinaryDataFactory）。
 * 不给基址就抛 "Ensure that the `cMapUrl` API parameter is provided."，而这条异常
 * 发生在渲染单页的过程里，不会把 loadingTask 打回 error——用户看到的是「加载完成、
 * 正文空白」。本站接受用户任意上传 PDF 且面向中日文读者，Word 导出的非嵌入 CID
 * 字体文档正是走 cmaps 这条路。
 *
 * 为什么用 postinstall + public/ 而不是 vite 插件 emitFile：这四个目录一共 ~4MB、
 * 169 个 bcmap，走 public/ 就同时拿到 dev server 静态服务和 build 期原样拷贝两件事，
 * 零额外代码；它们在 Cloudflare 上是 Static Assets，不计入 Worker 脚本体积。
 * 代价是这些文件不进版本库（见 .gitignore），新克隆必须先 npm install。
 * 缺了 public/pdfjs/ 也只是这类 PDF 渲染不出来，构建和其余功能都不受影响。
 */
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "pdfjs-dist");
const target = join(root, "public", "pdfjs");

// 与 use-pdf-viewer.ts 里的 cMapUrl / standardFontDataUrl / wasmUrl / iccUrl 一一对应，
// 改这里就要改那里。
const DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];
// 拷完才写的版本戳。写在最后是刻意的：拷到一半被打断就不会留下「已是最新」的假象。
const stamp = join(target, ".pdfjs-version");

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

try {
  const { version } = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  );

  // 版本没变就整个跳过。这既省掉每次构建几 MB 的无谓复制，也消掉了下面那段
  // 「先 rm 再 cp」的窗口：本脚本同时挂在 postinstall 和 build 上，而 build 完全
  // 可能在 dev server 开着的时候跑——真删下去，那一瞬间浏览器请求 bcmap 会拿到
  // 404（表现为该页文字空白，刷新即好）。跳过之后，只有升级 pdfjs 那一次才会
  // 真正重删重拷，那时本来就该重启 dev server。
  const fresh =
    (await readFile(stamp, "utf8").catch(() => null))?.trim() === version &&
    (await Promise.all(DIRS.map((dir) => exists(join(target, dir))))).every(
      Boolean,
    );
  if (fresh) {
    console.log(`pdfjs assets already up to date (${version})`);
  } else {
    await mkdir(target, { recursive: true });
    // 先删再拷：升级 pdfjs 后旧版本多出来的文件不该留在 public/ 里被一起部署。
    for (const dir of DIRS) {
      await rm(join(target, dir), { recursive: true, force: true });
      await cp(join(source, dir), join(target, dir), { recursive: true });
    }
    await writeFile(stamp, `${version}\n`);
    console.log(`pdfjs assets copied to public/pdfjs/ (${version})`);
  }
} catch (error) {
  // 绝不能让这里的失败挂掉整个 npm install：拿不到资源只是某类 PDF 渲染不出来，
  // 不值得把依赖安装一起拖下水（典型场景是 --ignore-scripts 之外的裁剪安装）。
  console.warn(
    `pdfjs assets not copied; PDFs needing CMaps/standard fonts/wasm may render blank. ${error}`,
  );
}

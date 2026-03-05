# 前端页面与国际化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现论文处理系统的前端页面（论文列表、详情、积分历史）和国际化，采用黄棕色学术科技风格。

**Architecture:** 基于 TanStack Start + tRPC + shadcn/ui，重写全局样式为学术黄棕色调，创建论文管理和积分历史页面，集成 SSE 实时更新，配置 Paraglide 国际化。

**Tech Stack:** TanStack Start, tRPC, shadcn/ui, Tailwind CSS v4, Paraglide, Cloudflare Workers

---

### Task 1: 重写全局样式系统

**Files:**
- Modify: `src/styles.css` (完全重写)

**Step 1: 重写 src/styles.css**

替换现有的海洋主题为学术黄棕色调。保留 shadcn/ui 的 CSS 变量结构，但更新所有颜色值。

```css
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap');
@import 'tailwindcss';
@plugin '@tailwindcss/typography';
@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

:root {
  /* 学术黄棕色调 */
  --parchment: #faf8f3;
  --parchment-warm: #f4f1e8;
  --ink: #2d2a24;
  --ink-soft: #6b6560;
  --academic-brown: #8b6f47;
  --academic-brown-deep: #6d5636;
  --gold: #c9a961;
  --olive: #6b8e23;
  --amber: #d4a574;
  --sienna: #a0522d;
  --line: rgba(139, 111, 71, 0.15);
  --surface: rgba(250, 248, 243, 0.74);
  --surface-strong: rgba(244, 241, 232, 0.9);
  --inset-glint: rgba(255, 252, 245, 0.82);
  --header-bg: rgba(250, 248, 243, 0.84);
  --neutral-light: #e8e4db;
  --neutral-mid: #c4bfb3;
  --neutral-dark: #6b6560;

  /* shadcn tokens - 学术黄棕色 */
  --background: oklch(0.98 0.005 85);
  --foreground: oklch(0.2 0.02 60);
  --card: oklch(0.97 0.008 80);
  --card-foreground: oklch(0.2 0.02 60);
  --popover: oklch(0.98 0.005 85);
  --popover-foreground: oklch(0.2 0.02 60);
  --primary: oklch(0.52 0.08 65);
  --primary-foreground: oklch(0.98 0.005 85);
  --secondary: oklch(0.93 0.01 80);
  --secondary-foreground: oklch(0.35 0.04 60);
  --muted: oklch(0.93 0.01 80);
  --muted-foreground: oklch(0.55 0.03 60);
  --accent: oklch(0.93 0.01 80);
  --accent-foreground: oklch(0.35 0.04 60);
  --destructive: oklch(0.5 0.15 30);
  --destructive-foreground: oklch(0.5 0.15 30);
  --border: oklch(0.9 0.01 80);
  --input: oklch(0.9 0.01 80);
  --ring: oklch(0.52 0.08 65);
  --chart-1: oklch(0.52 0.08 65);
  --chart-2: oklch(0.55 0.12 140);
  --chart-3: oklch(0.7 0.1 80);
  --chart-4: oklch(0.6 0.15 30);
  --chart-5: oklch(0.75 0.12 90);
  --radius: 0.75rem;
  --sidebar: oklch(0.97 0.008 80);
  --sidebar-foreground: oklch(0.2 0.02 60);
  --sidebar-primary: oklch(0.52 0.08 65);
  --sidebar-primary-foreground: oklch(0.98 0.005 85);
  --sidebar-accent: oklch(0.93 0.01 80);
  --sidebar-accent-foreground: oklch(0.35 0.04 60);
  --sidebar-border: oklch(0.9 0.01 80);
  --sidebar-ring: oklch(0.52 0.08 65);
}
```

**Step 2: 添加 dark 模式变量和 @theme inline**

紧接着 :root 后面添加 dark 模式和 theme 映射：

```css
.dark {
  --parchment: #1a1816;
  --parchment-warm: #221f1a;
  --ink: #e8e4db;
  --ink-soft: #a09888;
  --academic-brown: #c9a961;
  --academic-brown-deep: #d4b87a;
  --gold: #e0c478;
  --olive: #8fb33a;
  --amber: #e0b88a;
  --sienna: #c06a3a;
  --line: rgba(201, 169, 97, 0.2);
  --surface: rgba(26, 24, 22, 0.8);
  --surface-strong: rgba(34, 31, 26, 0.92);
  --inset-glint: rgba(201, 169, 97, 0.1);
  --header-bg: rgba(26, 24, 22, 0.84);
  --neutral-light: #2a2620;
  --neutral-mid: #4a4438;
  --neutral-dark: #a09888;

  --background: oklch(0.16 0.01 60);
  --foreground: oklch(0.92 0.01 80);
  --card: oklch(0.18 0.01 60);
  --card-foreground: oklch(0.92 0.01 80);
  --popover: oklch(0.16 0.01 60);
  --popover-foreground: oklch(0.92 0.01 80);
  --primary: oklch(0.75 0.1 80);
  --primary-foreground: oklch(0.16 0.01 60);
  --secondary: oklch(0.24 0.015 60);
  --secondary-foreground: oklch(0.92 0.01 80);
  --muted: oklch(0.24 0.015 60);
  --muted-foreground: oklch(0.65 0.03 70);
  --accent: oklch(0.24 0.015 60);
  --accent-foreground: oklch(0.92 0.01 80);
  --destructive: oklch(0.45 0.15 25);
  --destructive-foreground: oklch(0.65 0.2 25);
  --border: oklch(0.28 0.015 60);
  --input: oklch(0.28 0.015 60);
  --ring: oklch(0.75 0.1 80);
  --chart-1: oklch(0.75 0.1 80);
  --chart-2: oklch(0.65 0.12 140);
  --chart-3: oklch(0.7 0.1 80);
  --chart-4: oklch(0.6 0.18 25);
  --chart-5: oklch(0.75 0.12 90);
  --sidebar: oklch(0.18 0.01 60);
  --sidebar-foreground: oklch(0.92 0.01 80);
  --sidebar-primary: oklch(0.75 0.1 80);
  --sidebar-primary-foreground: oklch(0.16 0.01 60);
  --sidebar-accent: oklch(0.24 0.015 60);
  --sidebar-accent-foreground: oklch(0.92 0.01 80);
  --sidebar-border: oklch(0.28 0.015 60);
  --sidebar-ring: oklch(0.75 0.1 80);
}
```

**Step 3: 添加 @theme inline、基础样式和动画**

```css
@theme inline {
  --font-sans: 'Manrope', ui-sans-serif, system-ui, sans-serif;
  --font-serif: 'Fraunces', Georgia, serif;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

html, body, #app { min-height: 100%; }

body {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-sans);
  background-color: var(--parchment);
  background:
    radial-gradient(1100px 620px at -8% -10%, rgba(139,111,71,0.08), transparent 58%),
    radial-gradient(1050px 620px at 112% -12%, rgba(201,169,97,0.06), transparent 62%),
    linear-gradient(180deg, var(--parchment) 0%, var(--parchment-warm) 44%, var(--parchment) 100%);
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

/* 纸张纹理 */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
}

a { color: var(--academic-brown); text-decoration-color: rgba(139,111,71,0.4); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { color: var(--academic-brown-deep); }

.page-wrap { width: min(1200px, calc(100% - 2rem)); margin-inline: auto; }
.display-title { font-family: 'Fraunces', Georgia, serif; }

/* 卡片样式 */
.paper-card {
  border: 1px solid var(--line);
  background: linear-gradient(165deg, var(--surface-strong), var(--surface));
  box-shadow: 0 2px 16px rgba(45,42,36,0.08);
  backdrop-filter: blur(4px);
  border-radius: 12px;
  transition: transform 300ms cubic-bezier(0.16,1,0.3,1), box-shadow 300ms ease;
}
.paper-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 32px rgba(45,42,36,0.12);
}

/* 导航链接 */
.nav-link { position: relative; text-decoration: none; color: var(--ink-soft); }
.nav-link::after {
  content: '';
  position: absolute;
  left: 0; bottom: -8px;
  width: 100%; height: 2px;
  transform: scaleX(0);
  transform-origin: left;
  background: linear-gradient(90deg, var(--academic-brown), var(--gold));
  transition: transform 170ms ease;
}
.nav-link:hover, .nav-link.is-active { color: var(--ink); }
.nav-link:hover::after, .nav-link.is-active::after { transform: scaleX(1); }

/* 动画 */
.rise-in { animation: rise-in 700ms cubic-bezier(0.16,1,0.3,1) both; }
@keyframes rise-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes pulse-border {
  0%, 100% { border-color: var(--academic-brown); }
  50% { border-color: var(--gold); }
}

@keyframes highlight-flash {
  0% { background-color: transparent; }
  30% { background-color: rgba(139,111,71,0.08); }
  100% { background-color: transparent; }
}

.stagger-in > * {
  animation: rise-in 600ms cubic-bezier(0.16,1,0.3,1) both;
}
.stagger-in > *:nth-child(1) { animation-delay: 0ms; }
.stagger-in > *:nth-child(2) { animation-delay: 80ms; }
.stagger-in > *:nth-child(3) { animation-delay: 160ms; }
.stagger-in > *:nth-child(4) { animation-delay: 240ms; }
.stagger-in > *:nth-child(5) { animation-delay: 320ms; }
.stagger-in > *:nth-child(6) { animation-delay: 400ms; }
.stagger-in > *:nth-child(7) { animation-delay: 480ms; }
.stagger-in > *:nth-child(8) { animation-delay: 560ms; }

@layer base {
  * { @apply border-border outline-ring/50; }
  body { background-color: var(--background); color: var(--foreground); }
}
```

**Step 4: 验证样式编译**

Run: `npm run build 2>&1 | head -20`
Expected: 无 CSS 相关错误

**Step 5: 不提交，继续下一个任务**

---

### Task 2: 安装 shadcn/ui 组件

**Step 1: 安装所需的 shadcn/ui 组件**

Run: `npx shadcn@latest add card badge dialog table progress tabs toast accordion skeleton dropdown-menu alert-dialog breadcrumb separator`
Expected: 组件安装成功到 src/components/ui/

**Step 2: 验证组件安装**

Run: `ls src/components/ui/`
Expected: 包含所有新安装的组件文件

---

### Task 3: 更新 Header 和导航

**Files:**
- Modify: `src/components/Header.tsx`

**Step 1: 重写 Header.tsx**

清理模板导航链接（X、GitHub、Demos），替换为论文系统导航。

```tsx
import { Link } from "@tanstack/react-router";
import { FileText, Coins } from "lucide-react";
import { m } from "#/paraglide/messages";
import BetterAuthHeader from "../integrations/better-auth/header-user.tsx";
import ParaglideLocaleSwitcher from "./LocaleSwitcher.tsx";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-4 py-3 sm:py-4">
        <h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1.5 text-sm text-[var(--ink)] no-underline shadow-[0_2px_8px_rgba(45,42,36,0.06)]"
          >
            <span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,var(--academic-brown),var(--gold))]" />
            PicX
          </Link>
        </h2>

        <div className="flex items-center gap-x-4 text-sm font-semibold">
          <Link
            to="/papers"
            className="nav-link inline-flex items-center gap-1.5"
            activeProps={{ className: "nav-link is-active" }}
          >
            <FileText className="h-4 w-4" />
            {m.nav_papers()}
          </Link>
          <Link
            to="/credits"
            className="nav-link inline-flex items-center gap-1.5"
            activeProps={{ className: "nav-link is-active" }}
          >
            <Coins className="h-4 w-4" />
            {m.nav_credits()}
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <BetterAuthHeader />
          <ParaglideLocaleSwitcher />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
```

**Step 2: 验证编译**

Run: `npm run build 2>&1 | head -20`
Expected: 无错误（i18n key 会在 Task 10 添加）

---

### Task 4: SSE Hook

**Files:**
- Create: `src/hooks/use-paper-sse.ts`

**Step 1: 创建 SSE 连接 hook**

```typescript
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "#/integrations/trpc/react";

interface PaperStatusEvent {
  paperId: string;
  status: string;
  progress?: number;
  errorMessage?: string;
}

export function usePaperSSE(userId: string | undefined) {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!userId) return;

    const url = `/api/trpc/sse.connect`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data: PaperStatusEvent = JSON.parse(event.data);
        // Invalidate paper queries to trigger refetch
        queryClient.invalidateQueries({
          queryKey: trpc.paper.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.paper.getById.queryKey(data.paperId),
        });
        if (data.status === "completed" || data.status === "failed") {
          queryClient.invalidateQueries({
            queryKey: trpc.user.getProfile.queryKey(),
          });
        }
      } catch (e) {
        console.error("SSE parse error:", e);
      }
    };

    es.onerror = () => {
      es.close();
      // Reconnect after 3 seconds
      setTimeout(() => {
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      }, 3000);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [userId, queryClient, trpc]);
}
```

**Step 2: 验证编译**

Run: `npm run build 2>&1 | head -20`
Expected: 无错误

---

### Task 5: 上传对话框组件

**Files:**
- Create: `src/components/papers/upload-dialog.tsx`

**Step 1: 创建上传对话框**

实现双 Tab（文件上传 / arXiv 链接）的上传对话框。

```tsx
import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, Link as LinkIcon, FileText, Loader2 } from "lucide-react";
import { m } from "#/paraglide/messages";
import { useTRPC } from "#/integrations/trpc/react";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";

interface UploadDialogProps {
  credits: number;
  onSuccess?: () => void;
}

export function UploadDialog({ credits, onSuccess }: UploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [arxivUrl, setArxivUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const trpc = useTRPC();

  const getPresignedUrl = useMutation(
    trpc.upload.getPresignedUrl.mutationOptions()
  );
  const createPaper = useMutation(
    trpc.paper.create.mutationOptions()
  );

  const handleFileUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    try {
      const { uploadUrl, r2Key } = await getPresignedUrl.mutateAsync({
        filename: file.name,
        contentType: "application/pdf",
        fileSize: file.size,
      });
      await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/pdf" },
      });
      await createPaper.mutateAsync({
        sourceType: "upload",
        filename: file.name,
        fileSize: file.size,
        r2Key,
      });
      setOpen(false);
      setFile(null);
      onSuccess?.();
    } catch (e) {
      console.error("Upload failed:", e);
    } finally {
      setUploading(false);
    }
  }, [file, getPresignedUrl, createPaper, onSuccess]);

  const handleArxivSubmit = useCallback(async () => {
    if (!arxivUrl) return;
    setUploading(true);
    try {
      await createPaper.mutateAsync({
        sourceType: "arxiv",
        arxivUrl,
        filename: arxivUrl.split("/").pop() || "arxiv-paper",
        fileSize: 0,
        r2Key: `arxiv/${Date.now()}`,
      });
      setOpen(false);
      setArxivUrl("");
      onSuccess?.();
    } catch (e) {
      console.error("arXiv submit failed:", e);
    } finally {
      setUploading(false);
    }
  }, [arxivUrl, createPaper, onSuccess]);

  const insufficientCredits = credits < 10;

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === "application/pdf") {
      setFile(droppedFile);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white">
          <Upload className="mr-2 h-4 w-4" />
          {m.papers_upload()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px] rounded-3xl border-[var(--line)] bg-[var(--parchment)]">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {m.papers_upload()}
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="file">
          <TabsList className="w-full">
            <TabsTrigger value="file" className="flex-1 gap-1.5">
              <FileText className="h-4 w-4" />
              {m.upload_file_title()}
            </TabsTrigger>
            <TabsTrigger value="arxiv" className="flex-1 gap-1.5">
              <LinkIcon className="h-4 w-4" />
              {m.upload_arxiv_title()}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="mt-4">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--neutral-mid)] p-8 transition-colors hover:border-[var(--academic-brown)] hover:bg-[var(--academic-brown)]/5"
            >
              {file ? (
                <div className="text-center">
                  <FileText className="mx-auto h-10 w-10 text-[var(--academic-brown)]" />
                  <p className="mt-2 text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFile(null)}
                    className="mt-2"
                  >
                    {m.upload_change_file()}
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-[var(--neutral-mid)]" />
                  <p className="mt-3 text-sm text-[var(--ink-soft)]">
                    {m.upload_drag_hint()}
                  </p>
                  <label className="mt-2 cursor-pointer text-sm font-medium text-[var(--academic-brown)] hover:underline">
                    {m.upload_select_file()}
                    <input
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <p className="mt-1 text-xs text-[var(--neutral-mid)]">
                    PDF, max 50MB
                  </p>
                </>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-[var(--ink-soft)]">
                {m.credits_balance()}: {credits}
              </span>
              <span className="text-[var(--ink-soft)]">
                {m.upload_cost()}: 10
              </span>
            </div>
            <Button
              onClick={handleFileUpload}
              disabled={!file || uploading || insufficientCredits}
              className="mt-3 w-full bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white"
            >
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {m.upload_start()}
            </Button>
            {insufficientCredits && (
              <p className="mt-2 text-center text-xs text-[var(--sienna)]">
                {m.error_insufficient_credits()}
              </p>
            )}
          </TabsContent>

          <TabsContent value="arxiv" className="mt-4">
            <Input
              placeholder="https://arxiv.org/abs/2301.12345"
              value={arxivUrl}
              onChange={(e) => setArxivUrl(e.target.value)}
              className="border-[var(--line)]"
            />
            <p className="mt-2 text-xs text-[var(--ink-soft)]">
              {m.upload_arxiv_hint()}
            </p>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-[var(--ink-soft)]">
                {m.credits_balance()}: {credits}
              </span>
              <span className="text-[var(--ink-soft)]">
                {m.upload_cost()}: 10
              </span>
            </div>
            <Button
              onClick={handleArxivSubmit}
              disabled={!arxivUrl || uploading || insufficientCredits}
              className="mt-3 w-full bg-[var(--academic-brown)] hover:bg-[var(--academic-brown-deep)] text-white"
            >
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {m.upload_start()}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
```

---

### Task 6: 论文列表页

**Files:**
- Create: `src/routes/papers/index.tsx`
- Create: `src/components/papers/paper-list.tsx`

**Step 1: 创建论文卡片组件 paper-list.tsx**

```tsx
import { Link } from "@tanstack/react-router";
import {
  FileText, Clock, CheckCircle2, XCircle, Loader2, ImageIcon
} from "lucide-react";
import { m } from "#/paraglide/messages";
import { Badge } from "#/components/ui/badge";
import { Skeleton } from "#/components/ui/skeleton";

type PaperStatus = "pending" | "processing_text" | "processing_image" | "completed" | "failed";

interface Paper {
  id: string;
  title: string;
  status: PaperStatus;
  sourceType: string;
  fileSize: number;
  pageCount: number | null;
  createdAt: Date;
}

const statusConfig: Record<PaperStatus, {
  label: () => string;
  icon: React.ElementType;
  className: string;
  borderColor: string;
}> = {
  pending: {
    label: () => m.papers_status_pending(),
    icon: Clock,
    className: "bg-[var(--neutral-light)] text-[var(--ink-soft)] border-[var(--neutral-mid)]",
    borderColor: "var(--neutral-mid)",
  },
  processing_text: {
    label: () => m.papers_status_processing_text(),
    icon: Loader2,
    className: "bg-[var(--academic-brown)]/10 text-[var(--academic-brown)] border-[var(--academic-brown)]/30",
    borderColor: "var(--academic-brown)",
  },
  processing_image: {
    label: () => m.papers_status_processing_image(),
    icon: ImageIcon,
    className: "bg-[var(--gold)]/10 text-[var(--academic-brown-deep)] border-[var(--gold)]/30",
    borderColor: "var(--gold)",
  },
  completed: {
    label: () => m.papers_status_completed(),
    icon: CheckCircle2,
    className: "bg-[var(--olive)]/10 text-[var(--olive)] border-[var(--olive)]/30",
    borderColor: "var(--olive)",
  },
  failed: {
    label: () => m.papers_status_failed(),
    icon: XCircle,
    className: "bg-[var(--sienna)]/10 text-[var(--sienna)] border-[var(--sienna)]/30",
    borderColor: "var(--sienna)",
  },
};

export function PaperCard({ paper }: { paper: Paper }) {
  const config = statusConfig[paper.status];
  const StatusIcon = config.icon;
  const isProcessing = paper.status === "processing_text" || paper.status === "processing_image";

  return (
    <Link
      to="/papers/$paperId"
      params={{ paperId: paper.id }}
      className="paper-card block p-4 no-underline"
      style={{ borderLeftWidth: "4px", borderLeftColor: config.borderColor }}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--parchment-warm)]">
          <FileText className="h-5 w-5 text-[var(--academic-brown)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-[var(--ink)]">
            {paper.title}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--ink-soft)]">
            <span>{new Date(paper.createdAt).toLocaleDateString()}</span>
            {paper.pageCount && <span>· {paper.pageCount} pages</span>}
            <span>· {(paper.fileSize / 1024 / 1024).toFixed(1)} MB</span>
          </div>
        </div>
        <Badge
          variant="outline"
          className={`shrink-0 gap-1 ${config.className}`}
        >
          <StatusIcon className={`h-3 w-3 ${isProcessing ? "animate-spin" : ""}`} />
          {config.label()}
        </Badge>
      </div>
    </Link>
  );
}

export function PaperCardSkeleton() {
  return (
    <div className="paper-card p-4" style={{ borderLeftWidth: "4px", borderLeftColor: "var(--neutral-light)" }}>
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--parchment-warm)]">
        <FileText className="h-10 w-10 text-[var(--neutral-mid)]" />
      </div>
      <h3 className="mt-4 font-serif text-lg font-semibold text-[var(--ink)]">
        {m.papers_empty_title()}
      </h3>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        {m.papers_empty_description()}
      </p>
    </div>
  );
}
```

**Step 2: 创建论文列表路由 papers/index.tsx**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { m } from "#/paraglide/messages";
import { useTRPC } from "#/integrations/trpc/react";
import { usePaperSSE } from "#/hooks/use-paper-sse";
import { UploadDialog } from "#/components/papers/upload-dialog";
import { PaperCard, PaperCardSkeleton, EmptyState } from "#/components/papers/paper-list";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Button } from "#/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

type StatusFilter = "all" | "pending" | "processing_text" | "processing_image" | "completed" | "failed";

export const Route = createFileRoute("/papers/")({
  component: PapersPage,
});

function PapersPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const trpc = useTRPC();

  const profile = useQuery(trpc.user.getProfile.queryOptions());
  usePaperSSE(profile.data?.id);

  const papersQuery = useQuery(
    trpc.paper.list.queryOptions({
      page,
      limit: 20,
      status: statusFilter === "all" ? undefined : statusFilter,
    })
  );

  const totalPages = Math.ceil((papersQuery.data?.total ?? 0) / 20);

  return (
    <main className="page-wrap py-8">
      <div className="stagger-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-2xl font-bold text-[var(--ink)]">
            {m.papers_title()}
          </h1>
          <UploadDialog
            credits={profile.data?.credits ?? 0}
            onSuccess={() => papersQuery.refetch()}
          />
        </div>

        {/* Status filter tabs */}
        <Tabs
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v as StatusFilter); setPage(1); }}
          className="mt-6"
        >
          <TabsList>
            <TabsTrigger value="all">{m.papers_filter_all()}</TabsTrigger>
            <TabsTrigger value="processing_text">{m.papers_filter_processing()}</TabsTrigger>
            <TabsTrigger value="completed">{m.papers_filter_completed()}</TabsTrigger>
            <TabsTrigger value="failed">{m.papers_filter_failed()}</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Paper list */}
        <div className="mt-6 space-y-3">
          {papersQuery.isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <PaperCardSkeleton key={i} />
            ))
          ) : papersQuery.data?.papers.length === 0 ? (
            <EmptyState />
          ) : (
            papersQuery.data?.papers.map((paper) => (
              <PaperCard key={paper.id} paper={paper} />
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-[var(--ink-soft)]">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
```

---

### Task 7: 论文详情页

**Files:**
- Create: `src/routes/papers/$paperId.tsx`

**Step 1: 创建论文详情路由**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Download, Trash2, FileText, Clock,
  CheckCircle2, XCircle, Loader2, ImageIcon, ChevronRight
} from "lucide-react";
import { m } from "#/paraglide/messages";
import { useTRPC } from "#/integrations/trpc/react";
import { usePaperSSE } from "#/hooks/use-paper-sse";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { Progress } from "#/components/ui/progress";
import { Skeleton } from "#/components/ui/skeleton";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from "#/components/ui/accordion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";

export const Route = createFileRoute("/papers/$paperId")({
  component: PaperDetailPage,
});

const statusProgress: Record<string, number> = {
  pending: 10,
  processing_text: 40,
  processing_image: 70,
  completed: 100,
  failed: 0,
};

function PaperDetailPage() {
  const { paperId } = Route.useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const profile = useQuery(trpc.user.getProfile.queryOptions());
  usePaperSSE(profile.data?.id);

  const { data, isLoading } = useQuery(
    trpc.paper.getById.queryOptions(paperId)
  );

  const deleteMutation = useMutation(
    trpc.paper.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.paper.list.queryKey() });
      },
    })
  );

  if (isLoading) return <DetailSkeleton />;
  if (!data) return null;

  const { paper, result } = data;
  const progress = statusProgress[paper.status] ?? 0;

  return (
    <main className="page-wrap py-8">
      <div className="stagger-in">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm text-[var(--ink-soft)]">
          <Link to="/papers" className="hover:text-[var(--ink)]">
            {m.papers_title()}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="truncate text-[var(--ink)]">{paper.title}</span>
        </nav>

        {/* Two-column layout */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
          {/* Left: Paper info */}
          <div className="space-y-4">
            <div className="paper-card p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--parchment-warm)]">
                  <FileText className="h-6 w-6 text-[var(--academic-brown)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate font-serif text-lg font-bold text-[var(--ink)]">
                    {paper.title}
                  </h1>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {new Date(paper.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Status + Progress */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--ink-soft)]">{m.paper_status()}</span>
                  <StatusBadge status={paper.status} />
                </div>
                {paper.status !== "failed" && (
                  <Progress value={progress} className="mt-2 h-2" />
                )}
                {paper.errorMessage && (
                  <p className="mt-2 text-xs text-[var(--sienna)]">
                    {paper.errorMessage}
                  </p>
                )}
              </div>

              {/* Meta info */}
              <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--ink-soft)]">{m.paper_source()}</span>
                  <span>{paper.sourceType === "arxiv" ? "arXiv" : m.paper_source_upload()}</span>
                </div>
                {paper.pageCount && (
                  <div className="flex justify-between">
                    <span className="text-[var(--ink-soft)]">{m.paper_pages()}</span>
                    <span>{paper.pageCount}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[var(--ink-soft)]">{m.paper_size()}</span>
                  <span>{(paper.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-2 border-t border-[var(--line)] pt-4">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-[var(--sienna)]">
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      {m.paper_delete()}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{m.paper_delete_confirm_title()}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {m.paper_delete_confirm_description()}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{m.cancel()}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate(paperId)}
                        className="bg-[var(--sienna)] hover:bg-[var(--sienna)]/90"
                      >
                        {m.paper_delete()}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>

          {/* Right: Results */}
          <div className="space-y-4">
            {result ? (
              <>
                <Accordion type="single" collapsible defaultValue="summary">
                  <AccordionItem value="summary" className="paper-card px-6">
                    <AccordionTrigger className="font-serif text-lg font-semibold">
                      {m.paper_summary()}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="prose prose-sm max-w-none text-[var(--ink)]">
                        {result.summary}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                {result.mindmapImageR2Key && (
                  <div className="paper-card p-6">
                    <h2 className="font-serif text-lg font-semibold text-[var(--ink)]">
                      {m.paper_mindmap()}
                    </h2>
                    <div className="mt-4 overflow-hidden rounded-lg">
                      <img
                        src={`/api/r2/${result.mindmapImageR2Key}`}
                        alt="Mindmap"
                        className="w-full cursor-zoom-in"
                      />
                    </div>
                  </div>
                )}
              </>
            ) : paper.status !== "failed" ? (
              <div className="paper-card flex flex-col items-center justify-center p-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--academic-brown)]" />
                <p className="mt-4 text-sm text-[var(--ink-soft)]">
                  {m.paper_processing_hint()}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: () => string; icon: React.ElementType; className: string }> = {
    pending: { label: () => m.papers_status_pending(), icon: Clock, className: "bg-[var(--neutral-light)] text-[var(--ink-soft)]" },
    processing_text: { label: () => m.papers_status_processing_text(), icon: Loader2, className: "bg-[var(--academic-brown)]/10 text-[var(--academic-brown)]" },
    processing_image: { label: () => m.papers_status_processing_image(), icon: ImageIcon, className: "bg-[var(--gold)]/10 text-[var(--academic-brown-deep)]" },
    completed: { label: () => m.papers_status_completed(), icon: CheckCircle2, className: "bg-[var(--olive)]/10 text-[var(--olive)]" },
    failed: { label: () => m.papers_status_failed(), icon: XCircle, className: "bg-[var(--sienna)]/10 text-[var(--sienna)]" },
  };
  const c = configs[status] ?? configs.pending;
  const Icon = c.icon;
  const isSpinning = status.startsWith("processing");
  return (
    <Badge variant="outline" className={`gap-1 ${c.className}`}>
      <Icon className={`h-3 w-3 ${isSpinning ? "animate-spin" : ""}`} />
      {c.label()}
    </Badge>
  );
}

function DetailSkeleton() {
  return (
    <main className="page-wrap py-8">
      <Skeleton className="h-4 w-48" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-60 rounded-xl" />
      </div>
    </main>
  );
}
```

---

### Task 8: 积分历史页

**Files:**
- Create: `src/routes/credits/index.tsx`

**Step 1: 创建积分历史路由**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, ArrowUpRight, ArrowDownRight, Gift, ChevronLeft, ChevronRight } from "lucide-react";
import { m } from "#/paraglide/messages";
import { useTRPC } from "#/integrations/trpc/react";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "#/components/ui/table";

export const Route = createFileRoute("/credits/")({
  component: CreditsPage,
});

const typeIcons: Record<string, React.ElementType> = {
  initial: Gift,
  consume: ArrowDownRight,
  refund: ArrowUpRight,
  purchase: ArrowUpRight,
};

const typeLabels: Record<string, () => string> = {
  initial: () => m.credits_type_initial(),
  consume: () => m.credits_type_consume(),
  refund: () => m.credits_type_refund(),
  purchase: () => m.credits_type_purchase(),
};

function CreditsPage() {
  const [page, setPage] = useState(1);
  const trpc = useTRPC();

  const profile = useQuery(trpc.user.getProfile.queryOptions());
  const history = useQuery(
    trpc.user.getCreditHistory.queryOptions({ page, limit: 20 })
  );

  const totalPages = Math.ceil((history.data?.total ?? 0) / 20);

  return (
    <main className="page-wrap py-8">
      <div className="stagger-in">
        <h1 className="font-serif text-2xl font-bold text-[var(--ink)]">
          {m.credits_title()}
        </h1>

        {/* Balance card */}
        <div className="paper-card mt-6 flex items-center gap-4 p-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--academic-brown)] to-[var(--gold)]">
            <Coins className="h-7 w-7 text-white" />
          </div>
          <div>
            <p className="text-sm text-[var(--ink-soft)]">{m.credits_balance()}</p>
            <p className="font-serif text-3xl font-bold text-[var(--ink)]">
              {profile.isLoading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                profile.data?.credits ?? 0
              )}
            </p>
          </div>
        </div>

        {/* Transaction history */}
        <div className="paper-card mt-6 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{m.credits_col_time()}</TableHead>
                <TableHead>{m.credits_col_type()}</TableHead>
                <TableHead className="text-right">{m.credits_col_amount()}</TableHead>
                <TableHead>{m.credits_col_description()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  </TableRow>
                ))
              ) : history.data?.transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-12 text-center text-[var(--ink-soft)]">
                    {m.credits_empty()}
                  </TableCell>
                </TableRow>
              ) : (
                history.data?.transactions.map((tx) => {
                  const Icon = typeIcons[tx.type] ?? Coins;
                  const isPositive = tx.amount > 0;
                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="text-sm text-[var(--ink-soft)]">
                        {new Date(tx.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-sm">
                          <Icon className="h-3.5 w-3.5" />
                          {typeLabels[tx.type]?.() ?? tx.type}
                        </span>
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm font-semibold ${isPositive ? "text-[var(--olive)]" : "text-[var(--sienna)]"}`}>
                        {isPositive ? "+" : ""}{tx.amount}
                      </TableCell>
                      <TableCell className="text-sm text-[var(--ink-soft)]">
                        {tx.description}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-[var(--ink-soft)]">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
```

---

### Task 9: 更新 __root.tsx

**Files:**
- Modify: `src/routes/__root.tsx`

**Step 1: 更新页面标题和元信息**

将 `title: "TanStack Start Starter"` 改为 `title: "PicX - Paper Mindmap"`。

---

### Task 10: 国际化翻译文件

**Files:**
- Modify: `messages/en.json`
- Create: `messages/zh-CN.json`

**Step 1: 更新 messages/en.json**

添加所有前端页面需要的翻译 key：

```json
{
  "$schema": "https://inlang.com/schema/inlang-message-format",
  "home_page": "Home page",
  "about_page": "About page",
  "example_message": "Welcome to your i18n app.",
  "language_label": "Language",
  "current_locale": "Current locale: {locale}",
  "learn_router": "Learn Paraglide JS",
  "nav_papers": "Papers",
  "nav_credits": "Credits",
  "papers_title": "Papers",
  "papers_upload": "Upload Paper",
  "papers_filter_all": "All",
  "papers_filter_processing": "Processing",
  "papers_filter_completed": "Completed",
  "papers_filter_failed": "Failed",
  "papers_status_pending": "Pending",
  "papers_status_processing_text": "Extracting Text",
  "papers_status_processing_image": "Generating Image",
  "papers_status_completed": "Completed",
  "papers_status_failed": "Failed",
  "papers_empty_title": "No papers yet",
  "papers_empty_description": "Upload a PDF or paste an arXiv link to get started.",
  "paper_status": "Status",
  "paper_source": "Source",
  "paper_source_upload": "File Upload",
  "paper_pages": "Pages",
  "paper_size": "File Size",
  "paper_summary": "Summary",
  "paper_mindmap": "Mindmap",
  "paper_delete": "Delete",
  "paper_delete_confirm_title": "Delete this paper?",
  "paper_delete_confirm_description": "This action cannot be undone. The paper and its results will be permanently removed.",
  "paper_processing_hint": "Your paper is being processed. Results will appear here automatically.",
  "upload_file_title": "Upload File",
  "upload_arxiv_title": "arXiv Link",
  "upload_drag_hint": "Drag and drop a PDF file here",
  "upload_select_file": "or click to select",
  "upload_change_file": "Change file",
  "upload_cost": "Cost",
  "upload_start": "Start Processing",
  "upload_arxiv_hint": "Supports arxiv.org/abs/ and arxiv.org/pdf/ URLs",
  "credits_title": "Credit History",
  "credits_balance": "Current Balance",
  "credits_col_time": "Time",
  "credits_col_type": "Type",
  "credits_col_amount": "Amount",
  "credits_col_description": "Description",
  "credits_type_initial": "Initial Credits",
  "credits_type_consume": "Paper Processing",
  "credits_type_refund": "Refund",
  "credits_type_purchase": "Purchase",
  "credits_empty": "No transactions yet",
  "cancel": "Cancel",
  "error_insufficient_credits": "Insufficient credits. You need at least 10 credits."
}
```

**Step 2: 创建 messages/zh-CN.json**

```json
{
  "$schema": "https://inlang.com/schema/inlang-message-format",
  "home_page": "首页",
  "about_page": "关于",
  "example_message": "欢迎使用国际化应用。",
  "language_label": "语言",
  "current_locale": "当前语言: {locale}",
  "learn_router": "了解 Paraglide JS",
  "nav_papers": "论文",
  "nav_credits": "积分",
  "papers_title": "论文列表",
  "papers_upload": "上传论文",
  "papers_filter_all": "全部",
  "papers_filter_processing": "处理中",
  "papers_filter_completed": "已完成",
  "papers_filter_failed": "失败",
  "papers_status_pending": "等待处理",
  "papers_status_processing_text": "提取文本中",
  "papers_status_processing_image": "生成图片中",
  "papers_status_completed": "已完成",
  "papers_status_failed": "处理失败",
  "papers_empty_title": "暂无论文",
  "papers_empty_description": "上传 PDF 文件或粘贴 arXiv 链接开始使用。",
  "paper_status": "状态",
  "paper_source": "来源",
  "paper_source_upload": "文件上传",
  "paper_pages": "页数",
  "paper_size": "文件大小",
  "paper_summary": "论文总结",
  "paper_mindmap": "思维导图",
  "paper_delete": "删除",
  "paper_delete_confirm_title": "确认删除此论文？",
  "paper_delete_confirm_description": "此操作不可撤销。论文及其处理结果将被永久删除。",
  "paper_processing_hint": "论文正在处理中，结果将自动显示在此处。",
  "upload_file_title": "上传文件",
  "upload_arxiv_title": "arXiv 链接",
  "upload_drag_hint": "拖拽 PDF 文件到此处",
  "upload_select_file": "或点击选择文件",
  "upload_change_file": "更换文件",
  "upload_cost": "消耗积分",
  "upload_start": "开始处理",
  "upload_arxiv_hint": "支持 arxiv.org/abs/ 和 arxiv.org/pdf/ 格式链接",
  "credits_title": "积分历史",
  "credits_balance": "当前积分",
  "credits_col_time": "时间",
  "credits_col_type": "类型",
  "credits_col_amount": "金额",
  "credits_col_description": "描述",
  "credits_type_initial": "注册赠送",
  "credits_type_consume": "处理论文",
  "credits_type_refund": "退款",
  "credits_type_purchase": "购买积分",
  "credits_empty": "暂无交易记录",
  "cancel": "取消",
  "error_insufficient_credits": "积分不足，至少需要 10 积分。"
}
```

**Step 3: 更新 Paraglide 配置以包含 zh-CN**

检查 `project.inlang/settings.json`，确保 `languageTags` 包含 `"zh-CN"`，`sourceLanguageTag` 为 `"en"`。

**Step 4: 删除不需要的 messages/de.json**

Run: `trash messages/de.json`

**Step 5: 重新生成 Paraglide 消息**

Run: `npx @inlang/paraglide-js compile --project ./project.inlang`
Expected: 生成新的消息函数

---

### Task 11: 验证构建

**Step 1: 运行构建**

Run: `npm run build`
Expected: 构建成功，无错误

**Step 2: 检查类型**

Run: `npx tsc --noEmit`
Expected: 无类型错误

---

## 任务依赖关系

```
Task 1 (样式) ──┐
Task 2 (组件) ──┤
Task 10 (i18n) ─┼──→ Task 3 (Header) ──→ Task 5 (上传对话框) ──→ Task 6 (列表页)
                │                                                      ↓
Task 4 (SSE) ──┘                                              Task 7 (详情页)
                                                                       ↓
                                                              Task 8 (积分页)
                                                                       ↓
                                                              Task 9 (__root)
                                                                       ↓
                                                              Task 11 (验证)
```

**可并行执行：** Task 1 + Task 2 + Task 4 + Task 10

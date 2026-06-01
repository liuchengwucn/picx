import { CheckCircle2, Copy, Send, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { DialogTrigger } from "#/components/ui/dialog";
import {
  buildEmbedCode,
  buildSocialShareLinks,
  paperImageUrl,
  paperPageUrl,
} from "#/lib/embed-code";
import { m } from "#/paraglide/messages";

interface ShareDialogProps {
  shortId: string;
  title: string;
}

export function ShareDialog({ shortId, title }: ShareDialogProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [canSystemShare, setCanSystemShare] = useState(false);

  useEffect(() => {
    setCanSystemShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  const pageUrl = paperPageUrl(shortId);
  const imageUrl = paperImageUrl(shortId);
  const embedCode = buildEmbedCode(shortId, title);
  const social = buildSocialShareLinks(shortId, title);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const openShare = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const systemShare = async () => {
    try {
      await navigator.share({ title, url: pageUrl });
    } catch {
      // user cancelled or unsupported
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Share2 className="h-4 w-4" />
          <span className="hidden sm:inline">{m.paper_share_open()}</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg border-[var(--line)] bg-[var(--parchment)] shadow-[0_8px_32px_rgba(139,111,71,0.18)]">
        {/* Decorative ambient glow */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(201,169,97,0.12),transparent_70%)] blur-2xl" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(139,111,71,0.08),transparent_70%)] blur-2xl" />

        <DialogHeader className="relative">
          <DialogTitle className="font-serif text-xl text-[var(--ink)]">
            {m.paper_share_dialog_title()}
          </DialogTitle>
        </DialogHeader>

        <div className="relative space-y-5 pt-1">
          {/* Divider line with parchment warmth */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--line)] to-transparent" />

          {/* ── Section 1: Quick share ── */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--academic-brown)]">
              {m.paper_share_quick_title()}
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-[var(--line)] bg-[var(--parchment-warm)] text-[var(--ink)] transition-all hover:border-[var(--academic-brown)]/40 hover:bg-[var(--academic-brown)]/6 hover:text-[var(--ink)]"
                onClick={() => copy(pageUrl, "page")}
              >
                {copiedKey === "page" ? (
                  <CheckCircle2 className="h-4 w-4 text-[var(--olive)]" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copiedKey === "page"
                  ? m.paper_link_copied()
                  : m.paper_copy_link()}
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-[var(--line)] bg-[var(--parchment-warm)] text-[var(--ink)] transition-all hover:border-[var(--academic-brown)]/40 hover:bg-[var(--academic-brown)]/6 hover:text-[var(--ink)]"
                onClick={() => copy(imageUrl, "image")}
              >
                {copiedKey === "image" ? (
                  <CheckCircle2 className="h-4 w-4 text-[var(--olive)]" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copiedKey === "image"
                  ? m.paper_share_image_link_copied()
                  : m.paper_share_copy_image_link()}
              </Button>
            </div>
          </section>

          <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--line)] to-transparent" />

          {/* ── Section 2: Social share ── */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--academic-brown)]">
              {m.paper_share_social_title()}
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-[var(--line)] bg-[var(--parchment-warm)] text-[var(--ink)] transition-all hover:border-[var(--academic-brown)]/40 hover:bg-[var(--academic-brown)]/6"
                onClick={() => openShare(social.twitter)}
              >
                X
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-[var(--line)] bg-[var(--parchment-warm)] text-[var(--ink)] transition-all hover:border-[var(--academic-brown)]/40 hover:bg-[var(--academic-brown)]/6"
                onClick={() => openShare(social.weibo)}
              >
                微博
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-[var(--line)] bg-[var(--parchment-warm)] text-[var(--ink)] transition-all hover:border-[var(--academic-brown)]/40 hover:bg-[var(--academic-brown)]/6"
                onClick={() => openShare(social.reddit)}
              >
                Reddit
              </Button>
              {canSystemShare && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-[var(--line)] bg-[var(--parchment-warm)] text-[var(--ink)] transition-all hover:border-[var(--academic-brown)]/40 hover:bg-[var(--academic-brown)]/6"
                  onClick={systemShare}
                >
                  <Send className="h-4 w-4" />
                  {m.paper_share_system()}
                </Button>
              )}
            </div>
          </section>

          <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--line)] to-transparent" />

          {/* ── Section 3: Embed code ── */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--academic-brown)]">
              {m.paper_share_embed_title()}
            </h3>
            <p className="text-xs text-[var(--ink-soft)]">
              {m.paper_share_embed_desc()}
            </p>
            <textarea
              readOnly
              value={embedCode}
              rows={5}
              className="w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--parchment)] p-3 font-mono text-xs text-[var(--ink)] outline-none ring-0 transition-colors focus:border-[var(--academic-brown)]/50 focus:bg-[var(--parchment-warm)]"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-[var(--line)] bg-[var(--parchment-warm)] text-[var(--ink)] transition-all hover:border-[var(--academic-brown)]/40 hover:bg-[var(--academic-brown)]/6"
              onClick={() => copy(embedCode, "embed")}
            >
              {copiedKey === "embed" ? (
                <CheckCircle2 className="h-4 w-4 text-[var(--olive)]" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copiedKey === "embed"
                ? m.paper_share_embed_copied()
                : m.paper_share_copy_embed()}
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

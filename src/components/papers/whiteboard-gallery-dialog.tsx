import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

interface WhiteboardGalleryDialogProps {
  paperId: string;
  whiteboards: Array<{
    id: string;
    imageR2Key: string;
    promptId: string | null;
    promptName: string | null;
    isDefault: boolean;
    createdAt: Date;
  }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean; // 只读模式，不显示设置默认和删除按钮
}

export function WhiteboardGalleryDialog({
  paperId,
  whiteboards,
  open,
  onOpenChange,
  readOnly = false,
}: WhiteboardGalleryDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const setDefaultMutation = useMutation(
    trpc.paper.setDefaultWhiteboard.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.paper.getById.queryKey(paperId),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.paper.listWhiteboards.queryKey(paperId),
        });
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.paper.deleteWhiteboard.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.paper.getById.queryKey(paperId),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.paper.listWhiteboards.queryKey(paperId),
        });
        setDeleteConfirmId(null);
      },
    }),
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[min(98vw,1440px)] max-h-[96vh] overflow-hidden flex flex-col bg-[var(--parchment)] border-[var(--line)] rounded-[28px] shadow-[0_30px_120px_rgba(39,29,21,0.35)] sm:max-w-[min(98vw,1440px)]">
          <DialogHeader className="px-8 pt-8 pb-4 border-b border-[var(--line)]/30">
            <DialogTitle className="font-serif text-3xl font-bold text-[var(--ink)] tracking-tight">
              {m.paper_whiteboard_gallery_title()}
            </DialogTitle>
            <p className="text-sm text-[var(--ink-soft)] mt-2">
              {whiteboards.length}{" "}
              {whiteboards.length === 1 ? "version" : "versions"} available
            </p>
          </DialogHeader>

          <div className="overflow-y-auto px-8 py-6 flex-1">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {whiteboards.map((whiteboard, index) => (
                <div
                  key={whiteboard.id}
                  className="group relative"
                  style={{
                    animation: `fadeInUp 0.4s ease-out ${index * 0.08}s both`,
                  }}
                >
                  <div className="relative rounded-2xl border-2 border-[var(--line)] bg-[var(--parchment-warm)] p-4 transition-all duration-300 hover:border-[var(--academic-brown)]/40 hover:shadow-[0_12px_40px_rgba(87,61,38,0.15)] hover:-translate-y-1 flex flex-col h-full">
                    {/* Image Preview */}
                    <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-gradient-to-br from-white/80 to-[var(--parchment-warm)] border border-[var(--line)]/50">
                      <img
                        src={`/api/r2/${whiteboard.imageR2Key}`}
                        alt="Whiteboard"
                        className="w-full h-full object-contain p-2"
                      />
                      {whiteboard.isDefault && (
                        <div className="absolute top-3 right-3">
                          <Badge className="bg-[var(--academic-brown)] text-white border-0 shadow-lg font-medium px-3 py-1">
                            <Star className="h-3 w-3 mr-1 fill-current" />
                            {m.paper_whiteboard_default()}
                          </Badge>
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="mt-4 space-y-2 flex-1">
                      <div className="flex items-center justify-between text-xs text-[var(--ink-soft)]">
                        <span className="font-medium">
                          {new Date(whiteboard.createdAt).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            },
                          )}
                        </span>
                        <span className="text-[10px]">
                          {new Date(whiteboard.createdAt).toLocaleTimeString(
                            "en-US",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </span>
                      </div>
                      <div className="min-h-[52px]">
                        {whiteboard.promptName && (
                          <div className="text-xs text-[var(--ink)] bg-[var(--parchment)]/60 rounded-lg px-3 py-2 border border-[var(--line)]/30">
                            <span className="font-medium">
                              {m.paper_whiteboard_prompt()}:
                            </span>{" "}
                            <span className="text-[var(--ink-soft)]">
                              {whiteboard.promptName}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {!readOnly && !whiteboard.isDefault && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setDefaultMutation.mutate({
                              paperId,
                              whiteboardId: whiteboard.id,
                            })
                          }
                          disabled={setDefaultMutation.isPending}
                          className="flex-1 min-w-[120px] border-[var(--line)] hover:bg-[var(--academic-brown)] hover:text-white hover:border-[var(--academic-brown)] transition-all"
                        >
                          <Star className="h-3.5 w-3.5 mr-1.5" />
                          <span className="hidden sm:inline">
                            {m.paper_whiteboard_set_default()}
                          </span>
                          <span className="sm:hidden">默认</span>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className={`${!readOnly && !whiteboard.isDefault ? "flex-1 min-w-[100px]" : "flex-1 min-w-[120px]"} border-[var(--line)] hover:bg-[var(--parchment)] transition-all`}
                      >
                        <a href={`/api/r2/${whiteboard.imageR2Key}`} download>
                          <Download className="h-3.5 w-3.5 mr-1.5" />
                          <span className="hidden sm:inline">
                            {m.paper_whiteboard_download()}
                          </span>
                          <span className="sm:hidden">下载</span>
                        </a>
                      </Button>
                      {!readOnly && whiteboards.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteConfirmId(whiteboard.id)}
                          disabled={deleteMutation.isPending}
                          className="shrink-0 border-[var(--line)] hover:bg-[var(--sienna)] hover:text-white hover:border-[var(--sienna)] transition-all"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <AlertDialogContent className="bg-[var(--parchment)] border-[var(--line)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl text-[var(--ink)]">
              {m.paper_whiteboard_delete_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--ink-soft)]">
              {m.paper_whiteboard_delete_confirm_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[var(--line)] hover:bg-[var(--parchment-warm)]">
              {m.cancel()}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteConfirmId) {
                  deleteMutation.mutate({
                    paperId,
                    whiteboardId: deleteConfirmId,
                  });
                }
              }}
              className="bg-[var(--sienna)] hover:bg-[var(--sienna)]/90 text-white"
            >
              {m.paper_whiteboard_delete()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
}

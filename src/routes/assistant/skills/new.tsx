import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SkillDocumentEditor } from "#/components/assistant/skill-document-editor";
import { resolveSkillErrorMessage } from "#/components/assistant/skill-error";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import type { SkillInput } from "#/lib/skills";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/assistant/skills/new")({
  component: AssistantSkillNewPage,
  head: () => ({
    meta: [{ title: m.assistant_skills_new_title() }],
  }),
});

const EMPTY_FORM: SkillInput = { name: "", description: "", body: "" };

function AssistantSkillNewPage() {
  const { session, isSessionPending } = useRequireAuth("/assistant/skills");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const draft = useLocation({
    select: (location) => location.state.skillDraft,
  });

  const createMutation = useMutation(
    trpc.skills.create.mutationOptions({
      onSuccess: (row) => {
        void queryClient.invalidateQueries({
          queryKey: trpc.skills.list.queryKey(),
        });
        toast.success(m.assistant_skills_saved());
        void navigate({
          to: "/assistant/skills/$skillId",
          params: { skillId: row.id },
          replace: true,
        });
      },
      onError: (error) => toast.error(resolveSkillErrorMessage(error)),
    }),
  );

  if (isSessionPending) {
    return (
      <main className="page-wrap flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
      </main>
    );
  }

  // 未登录会被 useRequireAuth 送去登录页，这里不渲染任何东西
  if (!session) return null;

  return (
    <main className="page-wrap py-8">
      <Link
        to="/assistant/skills"
        className="inline-flex items-center gap-1 rounded-sm text-xs text-[var(--ink-soft)] transition-colors hover:text-[var(--academic-brown)] focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {m.assistant_skills_title()}
      </Link>

      <h1 className="mt-2 font-serif text-2xl text-[var(--ink)]">
        {m.assistant_skills_new_title()}
      </h1>

      <div className="mt-6">
        <SkillDocumentEditor
          initial={draft ?? EMPTY_FORM}
          isSaving={createMutation.isPending}
          onSave={(values) => createMutation.mutate(values)}
          allowPristineSave
        />
      </div>
    </main>
  );
}

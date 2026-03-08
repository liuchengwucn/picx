import { Globe } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { m } from "#/paraglide/messages";

export function PublicBadge() {
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-[var(--olive)] bg-[var(--olive)]/10 text-[var(--olive)] shadow-[0_2px_8px_rgba(107,142,35,0.12)]"
    >
      <Globe className="h-3 w-3" />
      {m.paper_public_badge()}
    </Badge>
  );
}

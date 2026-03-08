import { Globe } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { m } from "#/paraglide/messages";
import { paperCompletedBadgeClassName } from "./paper-badge-styles";

export function PublicBadge() {
  return (
    <Badge variant="outline" className={paperCompletedBadgeClassName}>
      <Globe className="h-3 w-3" />
      {m.paper_public_badge()}
    </Badge>
  );
}

import { CheckCircle2Icon, ClockIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Teacher } from "@/lib/admin/teachers";

const LABELS = {
  pending_approval: { text: "Pending", Icon: ClockIcon, variant: "secondary" as const },
  approved: { text: "Approved", Icon: CheckCircle2Icon, variant: "default" as const },
  rejected: { text: "Rejected", Icon: XCircleIcon, variant: "destructive" as const },
};

export function StatusBadge({ status }: { status: Teacher["approval_status"] }) {
  const { text, Icon, variant } = LABELS[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {text}
    </Badge>
  );
}

export function VerifiedIndicator({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CheckCircle2Icon className="size-3.5" aria-hidden /> Email verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-destructive">
      <XCircleIcon className="size-3.5" aria-hidden /> Email not verified
    </span>
  );
}

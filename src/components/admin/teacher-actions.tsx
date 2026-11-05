"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reviewTeacher } from "@/app/(app)/admin/actions";

type Props = { id: string; fullName: string; email: string; emailVerified: boolean };

export function TeacherActions({ id, fullName, email, emailVerified }: Props) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setMode(null);
    setReason("");
  }

  function confirm() {
    if (!mode) return;
    const decision = mode;
    startTransition(async () => {
      const result = await reviewTeacher({
        id,
        decision,
        reason: decision === "reject" ? reason : undefined,
      });
      if (result.ok) {
        toast.success(decision === "approve" ? `${fullName} approved` : `${fullName} rejected`);
        setMode(null);
        setReason("");
      } else {
        toast.error(result.message);
      }
    });
  }

  const hintId = `approve-hint-${id}`;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => setMode("approve")}
          disabled={!emailVerified}
          aria-describedby={emailVerified ? undefined : hintId}
        >
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("reject")}>
          Reject
        </Button>
      </div>
      {!emailVerified ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          Can&apos;t approve until the email is verified.
        </p>
      ) : null}

      <Dialog open={mode !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "approve" ? "Approve this user?" : "Reject this user?"}
            </DialogTitle>
            <DialogDescription>
              <strong className="text-foreground">{fullName}</strong> ({email}){" "}
              {mode === "approve"
                ? "will get access to WeCheck."
                : "will be denied access to WeCheck."}
            </DialogDescription>
          </DialogHeader>

          {mode === "reject" ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`reason-${id}`}>Reason (optional)</Label>
              <Textarea
                id={`reason-${id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="Shown to the user on their account page."
              />
              <p className="text-right text-xs text-muted-foreground">{reason.length}/500</p>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={mode === "reject" ? "destructive" : "default"}
              onClick={confirm}
              disabled={pending}
            >
              {pending ? "Saving..." : mode === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

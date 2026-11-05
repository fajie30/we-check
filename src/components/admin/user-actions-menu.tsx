"use client";

import { useState, useTransition } from "react";
import { ChevronDownIcon } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reviewTeacher } from "@/app/(app)/admin/actions";
import { createResetLink, setUserActive, updateUser } from "@/app/(app)/admin/teachers/user-actions";
import { CopyLink } from "./copy-link";

type Props = {
  id: string;
  fullName: string;
  email: string;
  emailVerified: boolean;
  active: boolean; // not deactivated
  awaitingApproval: boolean; // pending_approval
};
type Dialogs = "approve" | "reject" | "edit" | "deactivate" | "reactivate" | "link" | null;
type Result = { ok: true } | { ok: false; message: string };

/** One "Actions" dropdown per user, instead of a row of crowded buttons. */
export function UserActionsMenu({ id, fullName, email, emailVerified, active, awaitingApproval }: Props) {
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [reason, setReason] = useState("");
  const [name, setName] = useState(fullName);
  const [mail, setMail] = useState(email);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open(next: Exclude<Dialogs, null>) {
    setReason("");
    setName(fullName);
    setMail(email);
    setLink(null);
    setError(null);
    setDialog(next);
    if (next === "link") {
      startTransition(async () => {
        const res = await createResetLink({ id });
        if (res.ok && res.link) setLink(res.link);
        else if (!res.ok) setError(res.message);
      });
    }
  }

  function close() {
    if (!pending) setDialog(null);
  }

  function run(action: () => Promise<Result>, success: string) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(success);
        setDialog(null);
      } else {
        setError(res.message);
      }
    });
  }

  const canReview = awaitingApproval && active;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="sm" variant="outline" aria-label={`Actions for ${fullName}`}>
              Actions <ChevronDownIcon data-icon="inline-end" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-48">
          {canReview ? (
            <>
              <DropdownMenuItem disabled={!emailVerified} onClick={() => open("approve")}>
                <span className="grid">
                  Approve
                  {!emailVerified ? (
                    <span className="text-xs text-muted-foreground">Email not verified yet</span>
                  ) : null}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => open("reject")}>Reject</DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onClick={() => open("edit")}>Edit details</DropdownMenuItem>
          {active ? <DropdownMenuItem onClick={() => open("link")}>Password link</DropdownMenuItem> : null}
          <DropdownMenuSeparator />
          {active ? (
            <DropdownMenuItem variant="destructive" onClick={() => open("deactivate")}>
              Deactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => open("reactivate")}>Reactivate</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {dialog === "approve" || dialog === "reject" ? (
            <>
              <DialogHeader>
                <DialogTitle>{dialog === "approve" ? "Approve this user?" : "Reject this user?"}</DialogTitle>
                <DialogDescription>
                  <strong className="text-foreground">{fullName}</strong> ({email}){" "}
                  {dialog === "approve" ? "will get access to WeCheck." : "will be denied access to WeCheck."}
                </DialogDescription>
              </DialogHeader>
              {dialog === "reject" ? (
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
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={close} disabled={pending}>Cancel</Button>
                <Button
                  variant={dialog === "reject" ? "destructive" : "default"}
                  disabled={pending}
                  onClick={() => {
                    const decision = dialog === "approve" ? "approve" : "reject";
                    run(
                      async () => {
                        const res = await reviewTeacher({ id, decision, reason: decision === "reject" ? reason : undefined });
                        return res.ok ? { ok: true as const } : { ok: false as const, message: res.message };
                      },
                      decision === "approve" ? `${fullName} approved` : `${fullName} rejected`,
                    );
                  }}
                >
                  {pending ? "Saving..." : dialog === "approve" ? "Approve" : "Reject"}
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog === "edit" ? (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => updateUser({ id, fullName: name, email: mail }), "User updated");
              }}
            >
              <DialogHeader>
                <DialogTitle>Edit {fullName}</DialogTitle>
                <DialogDescription>
                  Changing the email takes effect immediately and counts as verified. Their password stays the same.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor={`eu-name-${id}`}>Full name</Label>
                <Input id={`eu-name-${id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`eu-email-${id}`}>Email</Label>
                <Input id={`eu-email-${id}`} type="email" value={mail} onChange={(e) => setMail(e.target.value)} required />
              </div>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close} disabled={pending}>Cancel</Button>
                <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
              </DialogFooter>
            </form>
          ) : null}

          {dialog === "deactivate" || dialog === "reactivate" ? (
            <>
              <DialogHeader>
                <DialogTitle>{dialog === "deactivate" ? "Deactivate" : "Reactivate"} {fullName}?</DialogTitle>
                <DialogDescription>
                  {dialog === "deactivate"
                    ? "They won't be able to sign in or use WeCheck. Nothing is deleted, and you can reactivate them any time."
                    : "They'll be able to sign in again with their existing password."}
                </DialogDescription>
              </DialogHeader>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={close} disabled={pending}>Cancel</Button>
                <Button
                  variant={dialog === "deactivate" ? "destructive" : "default"}
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => setUserActive({ id, active: dialog === "reactivate" }),
                      dialog === "deactivate" ? `${fullName} deactivated` : `${fullName} reactivated`,
                    )
                  }
                >
                  {pending ? "Saving..." : dialog === "deactivate" ? "Deactivate" : "Reactivate"}
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {dialog === "link" ? (
            <>
              <DialogHeader>
                <DialogTitle>Password link for {fullName}</DialogTitle>
                <DialogDescription>
                  A one-time link to choose a new password, for example if they forgot it. Send it to them privately.
                  It expires soon.
                </DialogDescription>
              </DialogHeader>
              {link ? <CopyLink link={link} label="Password link" /> : null}
              {!link && pending ? <p className="text-sm text-muted-foreground">Creating link...</p> : null}
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button onClick={close}>Done</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

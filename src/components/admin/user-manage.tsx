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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createResetLink, setUserActive, updateUser } from "@/app/(app)/admin/teachers/user-actions";
import { CopyLink } from "./copy-link";

type Props = { id: string; fullName: string; email: string; active: boolean };
type Mode = "edit" | "deactivate" | "reactivate" | "link" | null;

export function UserManage({ id, fullName, email, active }: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState(fullName);
  const [mail, setMail] = useState(email);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open(next: Exclude<Mode, null>) {
    setName(fullName);
    setMail(email);
    setError(null);
    setLink(null);
    setMode(next);
    if (next === "link") {
      startTransition(async () => {
        const res = await createResetLink({ id });
        if (res.ok && res.link) setLink(res.link);
        else if (!res.ok) setError(res.message);
      });
    }
  }

  function close() {
    if (!pending) setMode(null);
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(success);
        setMode(null);
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="xs" variant="outline" onClick={() => open("edit")}>
        Edit
      </Button>
      {active ? (
        <>
          <Button size="xs" variant="outline" onClick={() => open("link")}>
            Password link
          </Button>
          <Button size="xs" variant="outline" onClick={() => open("deactivate")}>
            Deactivate
          </Button>
        </>
      ) : (
        <Button size="xs" variant="outline" onClick={() => open("reactivate")}>
          Reactivate
        </Button>
      )}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {mode === "edit" ? (
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
                  Changing the email takes effect immediately and counts as verified. Their password stays
                  the same.
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

          {mode === "deactivate" || mode === "reactivate" ? (
            <>
              <DialogHeader>
                <DialogTitle>{mode === "deactivate" ? "Deactivate" : "Reactivate"} {fullName}?</DialogTitle>
                <DialogDescription>
                  {mode === "deactivate"
                    ? "They won't be able to sign in or use WeCheck. Nothing is deleted, and you can reactivate them any time."
                    : "They'll be able to sign in again with their existing password."}
                </DialogDescription>
              </DialogHeader>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={close} disabled={pending}>Cancel</Button>
                <Button
                  variant={mode === "deactivate" ? "destructive" : "default"}
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => setUserActive({ id, active: mode === "reactivate" }),
                      mode === "deactivate" ? `${fullName} deactivated` : `${fullName} reactivated`,
                    )
                  }
                >
                  {pending ? "Saving..." : mode === "deactivate" ? "Deactivate" : "Reactivate"}
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {mode === "link" ? (
            <>
              <DialogHeader>
                <DialogTitle>Password link for {fullName}</DialogTitle>
                <DialogDescription>
                  A one-time link to choose a new password, for example if they forgot it. Send it to them
                  privately. It expires soon.
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
    </div>
  );
}

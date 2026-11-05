"use client";

import { useState, useTransition } from "react";
import { UserPlusIcon } from "lucide-react";
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
import { NativeSelect } from "@/components/ui/native-select";
import { createUser } from "@/app/(app)/admin/teachers/user-actions";
import { CopyLink } from "./copy-link";

export function AddUserDialog({ roles }: { roles: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roles.find((r) => r.key === "instructor")?.key ?? roles[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ link: string; email: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setName("");
    setEmail("");
    setError(null);
    setInvite(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createUser({ fullName: name, email, role });
      if (res.ok && res.link) {
        setInvite({ link: res.link, email: res.email ?? email });
        toast.success("User added");
      } else if (!res.ok) {
        setError(res.message);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon data-icon="inline-start" /> Add user
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {invite ? (
            <>
              <DialogHeader>
                <DialogTitle>Send this link to {invite.email}</DialogTitle>
                <DialogDescription>
                  The account is ready and approved. The person opens this one-time link to choose their
                  password. It expires, so send it soon, and don&apos;t post it anywhere public.
                </DialogDescription>
              </DialogHeader>
              <CopyLink link={invite.link} label="Invite link" />
              <DialogFooter>
                <Button onClick={close}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={submit} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Add user</DialogTitle>
                <DialogDescription>
                  Creates an approved account. You&apos;ll get a link to give to the person so they can set
                  their own password.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-1.5">
                <Label htmlFor="au-name">Full name</Label>
                <Input id="au-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="au-email">Email</Label>
                <Input id="au-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="au-role">Role</Label>
                <NativeSelect id="au-role" value={role} onChange={(e) => setRole(e.target.value)}>
                  {roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Adding..." : "Add user"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

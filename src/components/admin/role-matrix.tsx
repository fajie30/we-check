"use client";

import { useState, useTransition } from "react";
import { LockIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { createRole, deleteRole, setRolePermission, updateRole } from "@/app/(app)/admin/roles/actions";
import type { PermissionRow, RoleRow } from "@/lib/admin/roles";
import type { PermissionKey } from "@/lib/auth/permissions";

type Props = { roles: RoleRow[]; permissions: PermissionRow[]; grants: string[] };
type Dialogs = { type: "create" } | { type: "edit"; role: RoleRow } | { type: "delete"; role: RoleRow } | null;

const applies = (p: PermissionRow, role: string) =>
  (p.roles === null || p.roles.includes(role)) && !p.excluded_roles.includes(role);

export function RoleMatrix({ roles, permissions, grants: initial }: Props) {
  const [grants, setGrants] = useState(() => new Set(initial));
  const [pendingCell, setPendingCell] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialogs>(null);

  function toggle(role: RoleRow, p: PermissionRow, next: boolean) {
    const cell = `${role.key}:${p.key}`;
    const before = new Set(grants);
    // Optimistic update, rolled back if the server refuses.
    setGrants((g) => {
      const n = new Set(g);
      if (next) n.add(cell);
      else n.delete(cell);
      return n;
    });
    setPendingCell(cell);
    startTransition(async () => {
      const res = await setRolePermission({ role: role.key, key: p.key as PermissionKey, granted: next });
      setPendingCell(null);
      if (res.ok) {
        toast.success(`${p.label}: ${role.label} access ${next ? "enabled" : "disabled"}`);
      } else {
        setGrants(before);
        toast.error(res.message);
      }
    });
  }

  const cellFor = (role: RoleRow, p: PermissionRow) => (
    <Cell
      role={role}
      p={p}
      checked={grants.has(`${role.key}:${p.key}`)}
      busy={pendingCell === `${role.key}:${p.key}`}
      onToggle={(next) => toggle(role, p, next)}
    />
  );

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialog({ type: "create" })}>
          <PlusIcon data-icon="inline-start" /> Add role
        </Button>
      </div>

      {/* Desktop / tablet */}
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-64">Module</TableHead>
              {roles.map((r) => (
                <TableHead key={r.key} className="min-w-32 align-top">
                  <RoleHeader role={r} onEdit={() => setDialog({ type: "edit", role: r })} onDelete={() => setDialog({ type: "delete", role: r })} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissions.map((p) => (
              <TableRow key={p.key}>
                <TableCell className="whitespace-normal">
                  <ModuleName p={p} />
                </TableCell>
                {roles.map((r) => (
                  <TableCell key={r.key}>{cellFor(r, p)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <div className="grid gap-4 md:hidden">
        <ul className="grid gap-2">
          {roles.map((r) => (
            <li key={r.key} className="border border-border p-3">
              <RoleHeader role={r} onEdit={() => setDialog({ type: "edit", role: r })} onDelete={() => setDialog({ type: "delete", role: r })} />
            </li>
          ))}
        </ul>
        <ul className="grid gap-3">
          {permissions.map((p) => (
            <li key={p.key} className="grid gap-3 border border-border p-4">
              <ModuleName p={p} />
              {roles.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-3 text-sm">
                  <span>{r.label}</span>
                  {cellFor(r, p)}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="size-3.5" aria-hidden /> System permissions are locked so the admin
        can&apos;t be locked out and no other role can approve users or edit roles.
      </p>

      <RoleDialog key={dialog ? `${dialog.type}-${"role" in dialog ? dialog.role.key : ""}` : "closed"} dialog={dialog} roles={roles} onClose={() => setDialog(null)} />
    </div>
  );
}

function ModuleName({ p }: { p: PermissionRow }) {
  return (
    <div className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-2 font-medium">
        {p.label}
        {p.admin_only ? <Badge variant="secondary">System</Badge> : null}
        {p.placeholder ? <Badge variant="outline">Coming soon</Badge> : null}
      </span>
      <span className="text-xs text-muted-foreground">{p.description}</span>
    </div>
  );
}

function RoleHeader({ role, onEdit, onDelete }: { role: RoleRow; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="grid gap-1">
      <span className="flex items-center gap-1 text-sm font-semibold">
        {role.label}
        {role.is_system ? <Badge variant="secondary">System</Badge> : null}
      </span>
      <span className="text-xs font-normal text-muted-foreground">
        {role.users} {role.users === 1 ? "person" : "people"}
      </span>
      {role.key !== "admin" ? (
        <span className="flex gap-1">
          <Button size="icon-xs" variant="ghost" onClick={onEdit} aria-label={`Rename ${role.label}`}>
            <PencilIcon />
          </Button>
          {!role.is_system ? (
            <Button size="icon-xs" variant="ghost" onClick={onDelete} aria-label={`Delete ${role.label}`}>
              <Trash2Icon />
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function Cell({
  role,
  p,
  checked,
  busy,
  onToggle,
}: {
  role: RoleRow;
  p: PermissionRow;
  checked: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  if (!applies(p, role.key)) {
    return (
      <span className="text-muted-foreground" aria-label="Not applicable">
        &mdash;
      </span>
    );
  }
  const label = `${p.label} for ${role.label}`;
  if (p.admin_only) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Switch checked={checked} disabled aria-label={`${label} (locked)`} />
        <LockIcon className="size-3.5" aria-hidden />
        <span className="sr-only">Locked system permission</span>
      </span>
    );
  }
  return <Switch checked={checked} disabled={busy} onCheckedChange={onToggle} aria-label={label} />;
}

function RoleDialog({ dialog, roles, onClose }: { dialog: Dialogs; roles: RoleRow[]; onClose: () => void }) {
  const [name, setName] = useState(dialog?.type === "edit" ? dialog.role.label : "");
  const [description, setDescription] = useState(dialog?.type === "edit" ? (dialog.role.description ?? "") : "");
  const [copyFrom, setCopyFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, success: string) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        toast.success(success);
        onClose();
      } else {
        setError(res.message);
      }
    });
  }

  const open = dialog !== null;
  const close = () => !pending && onClose();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {dialog?.type === "delete" ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete {dialog.role.label}?</DialogTitle>
              <DialogDescription>
                This removes the role and its permissions. It can only be deleted when nobody has it.
              </DialogDescription>
            </DialogHeader>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={pending}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => run(() => deleteRole({ key: dialog.role.key }), `${dialog.role.label} deleted`)}
              >
                {pending ? "Deleting..." : "Delete role"}
              </Button>
            </DialogFooter>
          </>
        ) : dialog ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (dialog.type === "create") {
                run(
                  () => createRole({ label: name, description, copyFrom: copyFrom || undefined }),
                  `${name.trim()} created`,
                );
              } else {
                run(() => updateRole({ key: dialog.role.key, label: name, description }), "Role updated");
              }
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>{dialog.type === "create" ? "Add role" : `Edit ${dialog.role.label}`}</DialogTitle>
              <DialogDescription>
                {dialog.type === "create"
                  ? "New roles start with no modules unless you copy them from another role."
                  : "Renaming doesn't change what the role can do."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="role-desc">Description (optional)</Label>
              <Textarea id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
            </div>
            {dialog.type === "create" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="role-copy">Start from</Label>
                <NativeSelect id="role-copy" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                  <option value="">No modules (start empty)</option>
                  {roles
                    .filter((r) => r.key !== "admin")
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        Copy modules from {r.label}
                      </option>
                    ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  For example, create &ldquo;Head&rdquo; from Teacher to get everything a teacher has, then add more.
                </p>
              </div>
            ) : null}

            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : dialog.type === "create" ? "Create role" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

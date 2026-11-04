"use client";

import { useState, useTransition } from "react";
import { LockIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setRolePermission } from "@/app/admin/roles/actions";
import { ROLES, ROLE_LABELS, type PermissionKey, type RoleName } from "@/lib/auth/permissions";
import type { PermissionRow } from "@/lib/admin/roles";

type Props = { permissions: PermissionRow[]; grants: string[] };

export function RoleMatrix({ permissions, grants: initial }: Props) {
  const [grants, setGrants] = useState(() => new Set(initial));
  const [busy, startTransition] = useTransition();
  const [pendingCell, setPendingCell] = useState<string | null>(null);

  function toggle(role: RoleName, p: PermissionRow, next: boolean) {
    const cell = `${role}:${p.key}`;
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
      const res = await setRolePermission({ role, key: p.key as PermissionKey, granted: next });
      setPendingCell(null);
      if (res.ok) {
        toast.success(`${p.label}: ${ROLE_LABELS[role]} access ${next ? "enabled" : "disabled"}`);
      } else {
        setGrants(before);
        toast.error(res.message);
      }
    });
  }

  function Cell({ role, p }: { role: RoleName; p: PermissionRow }) {
    const cell = `${role}:${p.key}`;
    if (!p.roles.includes(role)) {
      return (
        <span className="text-muted-foreground" aria-label="Not applicable">
          &mdash;
        </span>
      );
    }
    const checked = grants.has(cell);
    const label = `${p.label} for ${ROLE_LABELS[role]}`;
    if (p.admin_only) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={checked} disabled aria-label={`${label} (locked)`} />
          <LockIcon className="size-3.5" aria-hidden />
          <span className="sr-only">Locked system permission</span>
        </span>
      );
    }
    return (
      <Switch
        checked={checked}
        disabled={busy && pendingCell === cell}
        onCheckedChange={(next) => toggle(role, p, next)}
        aria-label={label}
      />
    );
  }

  const Name = ({ p }: { p: PermissionRow }) => (
    <div className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-2 font-medium">
        {p.label}
        {p.admin_only ? <Badge variant="secondary">System</Badge> : null}
        {p.placeholder ? <Badge variant="outline">Coming soon</Badge> : null}
      </span>
      <span className="text-xs text-muted-foreground">{p.description}</span>
    </div>
  );

  return (
    <div className="grid gap-4">
      {/* Desktop / tablet */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Module</TableHead>
              {ROLES.map((r) => (
                <TableHead key={r} className="w-32">
                  {ROLE_LABELS[r]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissions.map((p) => (
              <TableRow key={p.key}>
                <TableCell className="whitespace-normal">
                  <Name p={p} />
                </TableCell>
                {ROLES.map((r) => (
                  <TableCell key={r}>
                    <Cell role={r} p={p} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <ul className="grid gap-3 md:hidden">
        {permissions.map((p) => (
          <li key={p.key} className="grid gap-3 border border-border p-4">
            <Name p={p} />
            {ROLES.map((r) => (
              <div key={r} className="flex items-center justify-between gap-3 text-sm">
                <span>{ROLE_LABELS[r]}</span>
                <Cell role={r} p={p} />
              </div>
            ))}
          </li>
        ))}
      </ul>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="size-3.5" aria-hidden /> System permissions are locked so the admin
        can&apos;t be locked out and teachers can&apos;t approve teachers.
      </p>
    </div>
  );
}

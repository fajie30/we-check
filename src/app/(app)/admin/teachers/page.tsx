import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BanIcon, SearchIcon } from "lucide-react";
import { AddUserDialog } from "@/components/admin/add-user-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, VerifiedIndicator } from "@/components/admin/status-badge";
import { UserActionsMenu } from "@/components/admin/user-actions-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserRoleSelect } from "@/components/admin/user-role-select";
import { getAssignableRoles } from "@/lib/admin/roles";
import { countTeachers, getTeachers, type Teacher } from "@/lib/admin/teachers";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Users | Admin | WeCheck" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "deactivated", label: "Deactivated" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const STATUS_BY_FILTER: Record<"pending" | "approved" | "rejected", Teacher["approval_status"]> = {
  pending: "pending_approval",
  approved: "approved",
  rejected: "rejected",
};

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function TeachersPage({ searchParams }: PageProps<"/admin/teachers">) {
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Users</h1>
      <Suspense fallback={<ListSkeleton />}>
        <TeacherList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3" role="status" aria-label="Loading teachers">
      <div className="h-10 w-full animate-pulse bg-muted" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 w-full animate-pulse bg-muted" />
      ))}
    </div>
  );
}

async function TeacherList({
  searchParams,
}: {
  searchParams: PageProps<"/admin/teachers">["searchParams"];
}) {
  const sp = await searchParams;
  const rawStatus = first(sp.status);
  const filter: FilterKey = FILTERS.some((f) => f.key === rawStatus) ? (rawStatus as FilterKey) : "all";
  const q = (first(sp.q) ?? "").trim().slice(0, 100);

  const [result, assignable] = await Promise.all([getTeachers(), getAssignableRoles()]);
  if ("error" in result) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          Couldn&apos;t load teachers. Reload the page to try again.
        </AlertDescription>
      </Alert>
    );
  }

  const all = result.teachers;
  const counts = countTeachers(all);
  const countFor: Record<FilterKey, number> = { all: counts.total, ...counts };

  const needle = q.toLowerCase();
  const rows = all.filter(
    (t) =>
      (filter === "all" ||
        (filter === "deactivated"
          ? Boolean(t.deactivated_at)
          : !t.deactivated_at && t.approval_status === STATUS_BY_FILTER[filter])) &&
      (!needle || t.full_name.toLowerCase().includes(needle) || t.email.toLowerCase().includes(needle)),
  );

  const hrefFor = (key: FilterKey) => {
    const params = new URLSearchParams();
    if (key !== "all") params.set("status", key);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/admin/teachers?${qs}` : "/admin/teachers";
  };

  return (
    <div className="grid gap-5">
      <div className="flex justify-end">
        <AddUserDialog roles={assignable} />
      </div>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
          {FILTERS.map(({ key, label }) => (
            <Link
              key={key}
              href={hrefFor(key)}
              aria-current={filter === key ? "page" : undefined}
              className={cn(
                buttonVariants({ variant: filter === key ? "default" : "outline", size: "sm" }),
              )}
            >
              {label} ({countFor[key]})
            </Link>
          ))}
        </nav>

        <form action="/admin/teachers" method="get" role="search" className="flex gap-2">
          {filter !== "all" ? <input type="hidden" name="status" value={filter} /> : null}
          <Input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search name or email"
            aria-label="Search by name or email"
            maxLength={100}
            className="md:w-64"
          />
          <Button type="submit" variant="outline" size="icon" aria-label="Search">
            <SearchIcon />
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState hasAny={all.length > 0} filtered={filter !== "all" || q !== ""} />
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.full_name}</TableCell>
                    <TableCell>
                      <div className="grid gap-0.5">
                        <span className="break-all">{t.email}</span>
                        <VerifiedIndicator verified={t.email_verified} />
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(t.created_at)}</TableCell>
                    <TableCell>
                      <UserRoleSelect userId={t.id} fullName={t.full_name} role={t.role} roles={assignable} />
                    </TableCell>
                    <TableCell>
                      <StatusCell teacher={t} />
                    </TableCell>
                    <TableCell>
                      <RowActions teacher={t} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <ul className="grid gap-3 md:hidden">
            {rows.map((t) => (
              <li key={t.id}>
                <Card>
                  <CardContent className="grid gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid gap-0.5">
                        <p className="font-medium">{t.full_name}</p>
                        <p className="text-sm break-all text-muted-foreground">{t.email}</p>
                      </div>
                      <StatusPill teacher={t} />
                    </div>
                    <VerifiedIndicator verified={t.email_verified} />
                    <UserRoleSelect userId={t.id} fullName={t.full_name} role={t.role} roles={assignable} />
                    <p className="text-xs text-muted-foreground">
                      Registered {formatDate(t.created_at)}
                    </p>
                    {t.rejection_reason ? (
                      <p className="text-xs text-muted-foreground">Reason: {t.rejection_reason}</p>
                    ) : null}
                    <RowActions teacher={t} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function StatusCell({ teacher }: { teacher: Teacher }) {
  return (
    <div className="grid gap-1">
      <StatusPill teacher={teacher} />
      {teacher.rejection_reason ? (
        <span className="text-xs text-muted-foreground">Reason: {teacher.rejection_reason}</span>
      ) : null}
    </div>
  );
}

function StatusPill({ teacher }: { teacher: Teacher }) {
  if (teacher.deactivated_at) {
    return (
      <Badge variant="destructive">
        <BanIcon aria-hidden />
        Deactivated
      </Badge>
    );
  }
  return <StatusBadge status={teacher.approval_status} />;
}

function RowActions({ teacher }: { teacher: Teacher }) {
  const decided =
    teacher.approval_status !== "pending_approval" && teacher.reviewed_at ? (
      <span className="text-xs text-muted-foreground">Decided {formatDate(teacher.reviewed_at)}</span>
    ) : null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <UserActionsMenu
        id={teacher.id}
        fullName={teacher.full_name}
        email={teacher.email}
        emailVerified={teacher.email_verified}
        active={!teacher.deactivated_at}
        awaitingApproval={teacher.approval_status === "pending_approval"}
      />
      {decided}
    </div>
  );
}

function EmptyState({ hasAny, filtered }: { hasAny: boolean; filtered: boolean }) {
  return (
    <div className="grid gap-2 border border-dashed border-border p-10 text-center">
      <p className="font-medium">
        {!hasAny ? "No users have registered yet" : "No users match"}
      </p>
      <p className="text-sm text-muted-foreground">
        {!hasAny
          ? "New registrations will show up here for your review."
          : filtered
            ? "Try a different status or search term."
            : ""}
      </p>
      {hasAny && filtered ? (
        <Link
          href="/admin/teachers"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mx-auto mt-2")}
        >
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { countTeachers, getTeachers } from "@/lib/admin/teachers";

export const metadata: Metadata = { title: "Admin | WeCheck" };

export default function AdminPage() {
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Overview</h1>
      <Suspense fallback={<CountsSkeleton />}>
        <Counts />
      </Suspense>
    </div>
  );
}

function CountsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3" role="status" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse bg-muted" />
      ))}
    </div>
  );
}

async function Counts() {
  const result = await getTeachers();
  if ("error" in result) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Couldn&apos;t load registrations. Reload the page to try again.</AlertDescription>
      </Alert>
    );
  }
  const counts = countTeachers(result.teachers);
  const items = [
    { label: "Pending", value: counts.pending, href: "/admin/teachers?status=pending", note: "Waiting for your decision" },
    { label: "Approved", value: counts.approved, href: "/admin/teachers?status=approved", note: "Can use WeCheck" },
    { label: "Rejected", value: counts.rejected, href: "/admin/teachers?status=rejected", note: "Access denied" },
    { label: "Deactivated", value: counts.deactivated, href: "/admin/teachers?status=deactivated", note: "Sign-in blocked" },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <Link key={item.label} href={item.href} className="block focus-visible:outline-2">
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardDescription>{item.label}</CardDescription>
                <CardTitle className="text-3xl">{item.value}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">{item.note}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {counts.total} user{counts.total === 1 ? "" : "s"} registered in total.{" "}
        <Link href="/admin/teachers" className="text-foreground underline underline-offset-4">
          Manage users
        </Link>
      </p>
    </div>
  );
}

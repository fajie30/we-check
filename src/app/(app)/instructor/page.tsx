import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton } from "@/components/auth/auth-shell";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Instructor | WeCheck" };

export default function InstructorPage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Suspense fallback={<CardSkeleton />}>
        <InstructorContent />
      </Suspense>
    </div>
  );
}

async function InstructorContent() {
  // Re-checks on the server: session + verified email + instructor + approved.
  const { profile, permissions } = await requirePermission("instructor_dashboard");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Instructor dashboard</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{profile.full_name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="break-all">{profile.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <Badge>Approved</Badge>
            </dd>
          </div>
        </dl>
        {permissions.includes("courses") ? (
          <Link href="/courses" className={buttonVariants({ variant: "outline" })}>
            My courses
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

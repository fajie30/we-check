import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell, CardSkeleton } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireApprovedInstructor } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Instructor | WeCheck" };

export default function InstructorPage() {
  return (
    <AuthShell>
      <Suspense fallback={<CardSkeleton />}>
        <InstructorContent />
      </Suspense>
    </AuthShell>
  );
}

async function InstructorContent() {
  // Re-checks on the server: session + verified email + instructor + approved.
  const { profile } = await requireApprovedInstructor();
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
        <SignOutButton />
      </CardContent>
    </Card>
  );
}

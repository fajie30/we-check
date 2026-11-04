import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell, CardSkeleton } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePending } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Pending approval | WeCheck" };

export default function PendingApprovalPage() {
  return (
    <AuthShell>
      <Suspense fallback={<CardSkeleton />}>
        <PendingContent />
      </Suspense>
    </AuthShell>
  );
}

async function PendingContent() {
  // Approved users are redirected to /instructor, rejected users to /rejected.
  const { profile } = await requirePending();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Waiting for approval</CardTitle>
        <CardDescription>Hi {profile.full_name}, your email is verified.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          An administrator needs to approve your teacher account before you can use WeCheck. Sign
          in again later to check your status.
        </p>
        <SignOutButton />
      </CardContent>
    </Card>
  );
}

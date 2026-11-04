import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell, CardSkeleton } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRejected } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Registration declined | WeCheck" };

export default function RejectedPage() {
  return (
    <AuthShell>
      <Suspense fallback={<CardSkeleton />}>
        <RejectedContent />
      </Suspense>
    </AuthShell>
  );
}

async function RejectedContent() {
  const { profile } = await requireRejected();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Registration declined</CardTitle>
        <CardDescription>Hi {profile.full_name}.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Your teacher registration was not approved, so this account has no access to WeCheck.
        </p>
        {profile.rejection_reason ? (
          <p className="border-l-2 border-border pl-3 text-sm">
            <span className="text-muted-foreground">Reason: </span>
            {profile.rejection_reason}
          </p>
        ) : null}
        <SignOutButton />
      </CardContent>
    </Card>
  );
}

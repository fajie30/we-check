import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell, CardSkeleton } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDeactivated } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Account deactivated | WeCheck" };

export default function DeactivatedPage() {
  return (
    <AuthShell>
      <Suspense fallback={<CardSkeleton />}>
        <DeactivatedContent />
      </Suspense>
    </AuthShell>
  );
}

async function DeactivatedContent() {
  const { profile } = await requireDeactivated();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account deactivated</CardTitle>
        <CardDescription>Hi {profile.full_name}.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Your account has been deactivated, so you can&apos;t use WeCheck right now. Contact your
          administrator if you think this is a mistake.
        </p>
        <SignOutButton />
      </CardContent>
    </Card>
  );
}

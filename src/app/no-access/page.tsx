import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, CardSkeleton } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireApprovedInstructor } from "@/lib/auth/access";

export const metadata: Metadata = { title: "No access | WeCheck" };

export default function NoAccessPage() {
  return (
    <AuthShell>
      <Suspense fallback={<CardSkeleton />}>
        <NoAccessContent />
      </Suspense>
    </AuthShell>
  );
}

async function NoAccessContent() {
  const { profile, permissions } = await requireApprovedInstructor();
  // If access was restored, go straight back.
  if (permissions.includes("instructor_dashboard")) redirect("/instructor");
  return (
    <Card>
      <CardHeader>
        <CardTitle>No modules available</CardTitle>
        <CardDescription>Hi {profile.full_name}, your account is approved.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          The Teacher role doesn&apos;t currently have access to any module. Ask your administrator
          to enable access, then sign in again.
        </p>
        <SignOutButton />
      </CardContent>
    </Card>
  );
}

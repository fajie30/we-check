import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, CardSkeleton } from "@/components/auth/auth-shell";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccessState } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Set your password | WeCheck" };

export default function SetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={<CardSkeleton />}>
        <SetPasswordContent />
      </Suspense>
    </AuthShell>
  );
}

async function SetPasswordContent() {
  // Needs the session created by the invite / reset link.
  const state = await getAccessState();
  if (state.kind === "anon") redirect("/login");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose your password</CardTitle>
        <CardDescription>You&apos;ll use it to sign in to WeCheck from now on.</CardDescription>
      </CardHeader>
      <CardContent>
        <SetPasswordForm />
      </CardContent>
    </Card>
  );
}

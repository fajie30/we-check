import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell, CardSkeleton } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirectIfSignedIn } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Sign in | WeCheck" };

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={<CardSkeleton />}>
        <LoginContent />
      </Suspense>
    </AuthShell>
  );
}

async function LoginContent() {
  await redirectIfSignedIn();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use your WeCheck account email and password.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}

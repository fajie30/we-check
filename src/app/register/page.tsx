import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell, CardSkeleton } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirectIfSignedIn } from "@/lib/auth/access";

export const metadata: Metadata = { title: "Create account | WeCheck" };

export default function RegisterPage() {
  return (
    <AuthShell>
      <Suspense fallback={<CardSkeleton />}>
        <RegisterContent />
      </Suspense>
    </AuthShell>
  );
}

async function RegisterContent() {
  await redirectIfSignedIn();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Teacher registration</CardTitle>
        <CardDescription>
          Create your account. An administrator reviews every new teacher before access is granted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm />
      </CardContent>
    </Card>
  );
}

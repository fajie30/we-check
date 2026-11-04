import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthShell, CardSkeleton } from "@/components/auth/auth-shell";
import { ResendForm } from "@/components/auth/resend-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Verify your email | WeCheck" };

export default function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  return (
    <AuthShell>
      <Suspense fallback={<CardSkeleton />}>
        <VerifyContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function VerifyContent({
  searchParams,
}: {
  searchParams: PageProps<"/verify-email">["searchParams"];
}) {
  const { error } = await searchParams;
  const linkProblem = error === "link";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify your email</CardTitle>
        <CardDescription>
          Open the link we emailed you to verify your address. Verifying does not approve your
          account; an administrator does that separately.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {linkProblem ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              That verification link is invalid or has expired. If you already verified, try signing
              in. Otherwise request a new link below.
            </AlertDescription>
          </Alert>
        ) : null}
        <ResendForm />
        <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}

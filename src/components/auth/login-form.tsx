"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/auth/actions";
import { loginSchema, type FormState } from "@/lib/auth/schemas";
import { Field } from "./field";
import { PasswordInput } from "./password-input";
import { ResendForm } from "./resend-form";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, { status: "idle" } as FormState);
  const [clientErrors, setClientErrors] = useState<FormState["fieldErrors"]>();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const parsed = loginSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      setClientErrors(z.flattenError(parsed.error).fieldErrors);
      return;
    }
    setClientErrors(undefined);
    startTransition(() => formAction(formData));
  }

  const errors = clientErrors ?? state.fieldErrors;

  return (
    <div className="grid gap-4">
      <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
        {state.status === "error" && state.message ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        <Field id="email" label="Email" error={errors?.email?.[0]}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(errors?.email)}
            aria-describedby={errors?.email ? "email-error" : undefined}
          />
        </Field>

        <Field id="password" label="Password" error={errors?.password?.[0]}>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
            aria-invalid={Boolean(errors?.password)}
            aria-describedby={errors?.password ? "password-error" : undefined}
          />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      {state.status === "unverified" ? (
        <div className="grid gap-3 border border-border p-4">
          <p role="alert" className="text-sm">
            {state.message} Check your inbox for the verification link, or request a new one.
          </p>
          <ResendForm email={state.email} />
        </div>
      ) : null}

      <p className="text-center text-sm text-muted-foreground">
        New teacher?{" "}
        <Link href="/register" className="text-foreground underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  );
}

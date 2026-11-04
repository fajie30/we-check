"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { z } from "zod";
import { MailCheckIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { register } from "@/lib/auth/actions";
import { registerSchema, type FormState } from "@/lib/auth/schemas";
import { Field } from "./field";
import { PasswordInput } from "./password-input";
import { ResendForm } from "./resend-form";

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(register, { status: "idle" } as FormState);
  const [clientErrors, setClientErrors] = useState<FormState["fieldErrors"]>();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const parsed = registerSchema.safeParse({
      fullName: formData.get("fullName"),
      email: formData.get("email"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });
    if (!parsed.success) {
      setClientErrors(z.flattenError(parsed.error).fieldErrors);
      return;
    }
    setClientErrors(undefined);
    startTransition(() => formAction(formData));
  }

  if (state.status === "success") {
    return (
      <div className="grid gap-4" role="status">
        <MailCheckIcon className="size-8" aria-hidden />
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-sm text-muted-foreground">
          We sent a verification link to <strong className="text-foreground">{state.email}</strong>.
          Open it to verify your address. After that, an administrator must approve your account
          before you can use WeCheck.
        </p>
        <ResendForm email={state.email} />
        <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
          Back to sign in
        </Link>
      </div>
    );
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

        <Field id="fullName" label="Full name" error={errors?.fullName?.[0]}>
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            required
            aria-invalid={Boolean(errors?.fullName)}
            aria-describedby={errors?.fullName ? "fullName-error" : undefined}
          />
        </Field>

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

        <Field
          id="password"
          label="Password"
          error={errors?.password?.[0]}
          hint="At least 10 characters, with a letter and a number."
        >
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            aria-invalid={Boolean(errors?.password)}
            aria-describedby={errors?.password ? "password-error" : undefined}
          />
        </Field>

        <Field id="confirmPassword" label="Confirm password" error={errors?.confirmPassword?.[0]}>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            required
            aria-invalid={Boolean(errors?.confirmPassword)}
            aria-describedby={errors?.confirmPassword ? "confirmPassword-error" : undefined}
          />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? "Creating account..." : "Create account"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already registered?{" "}
        <Link href="/login" className="text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}

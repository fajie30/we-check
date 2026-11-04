"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { setPassword } from "@/lib/auth/actions";
import { setPasswordSchema, type FormState } from "@/lib/auth/schemas";
import { Field } from "./field";
import { PasswordInput } from "./password-input";

export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState(setPassword, { status: "idle" } as FormState);
  const [clientErrors, setClientErrors] = useState<FormState["fieldErrors"]>();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const parsed = setPasswordSchema.safeParse({
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

  const errors = clientErrors ?? state.fieldErrors;

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
      {state.status === "error" && state.message ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        id="password"
        label="New password"
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
        {pending ? "Saving..." : "Save password"}
      </Button>
    </form>
  );
}

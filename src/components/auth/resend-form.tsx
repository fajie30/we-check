"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resendVerification } from "@/lib/auth/actions";
import { resendSchema, type FormState } from "@/lib/auth/schemas";
import { Field } from "./field";

const COOLDOWN_SECONDS = 60;

export function ResendForm({ email = "" }: { email?: string }) {
  const [remaining, setRemaining] = useState(0);
  const [clientErrors, setClientErrors] = useState<FormState["fieldErrors"]>();

  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData): Promise<FormState> => {
      const result = await resendVerification(prev, formData);
      if (result.status === "success") {
        setRemaining(COOLDOWN_SECONDS);
        toast.success("Verification email sent");
      } else if (result.message) {
        toast.error(result.message);
      }
      return result;
    },
    { status: "idle" },
  );

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const parsed = resendSchema.safeParse({ email: formData.get("email") });
    if (!parsed.success) {
      setClientErrors(z.flattenError(parsed.error).fieldErrors);
      return;
    }
    setClientErrors(undefined);
    startTransition(() => formAction(formData));
  }

  const error = (clientErrors ?? state.fieldErrors)?.email?.[0];
  const disabled = pending || remaining > 0;

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="grid gap-3">
      <Field id="resend-email" label="Email" error={error}>
        <Input
          id="resend-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={email}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "resend-email-error" : undefined}
        />
      </Field>
      <Button type="submit" variant="outline" disabled={disabled}>
        {pending
          ? "Sending..."
          : remaining > 0
            ? `Resend available in ${remaining}s`
            : "Resend verification email"}
      </Button>
      {state.status === "success" && state.message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

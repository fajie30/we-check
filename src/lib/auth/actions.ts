"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { destinationFor, resolveState } from "./access";
import { loginSchema, registerSchema, resendSchema, type FormState } from "./schemas";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const CALLBACK_URL = `${SITE_URL}/auth/callback`;

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const isRateLimited = (e: { status?: number; code?: string }) =>
  e.status === 429 || e.code === "over_request_rate_limit" || e.code === "over_email_send_rate_limit";

const RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";

export async function register(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    fullName: text(formData, "fullName"),
    email: text(formData, "email"),
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { fullName, email, password } = parsed.data;

  const supabase = await createClient();
  // Only full_name is sent as metadata. Role and status are set by the database
  // trigger and cannot be influenced from here.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: CALLBACK_URL },
  });

  if (error) {
    if (isRateLimited(error)) return { status: "error", message: RATE_LIMIT_MESSAGE };
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: ["Choose a stronger password"] } };
    }
    return { status: "error", message: "We couldn't create your account. Please try again." };
  }

  // Registration must never log the user in.
  if (data.session) await supabase.auth.signOut();

  // Same response whether or not the email already exists (no enumeration).
  return { status: "success", email };
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    if (error && isRateLimited(error)) return { status: "error", message: RATE_LIMIT_MESSAGE };
    // Supabase only reports this once the password was correct, so it leaks nothing.
    if (error?.code === "email_not_confirmed") {
      return {
        status: "unverified",
        email: parsed.data.email,
        message: "Please verify your email before signing in.",
      };
    }
    return { status: "error", message: "Invalid email or password" };
  }

  redirect(destinationFor(await resolveState(supabase, data.user)));
}

export async function resendVerification(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resendSchema.safeParse({ email: text(formData, "email") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: CALLBACK_URL },
  });

  if (error && isRateLimited(error)) {
    return {
      status: "error",
      message: "Please wait a minute before requesting another email.",
    };
  }
  // Generic on every other outcome so this can't be used to probe for accounts.
  return {
    status: "success",
    email: parsed.data.email,
    message: "If that address has a pending registration, a new verification email is on its way.",
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut(); // clears the session cookies
  redirect("/login");
}

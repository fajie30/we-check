import { z } from "zod";

// Shared by client forms (UX only) and server actions (authoritative).

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, "Full name must be at least 2 characters")
  .max(100, "Full name must be 100 characters or fewer");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

// 72 = bcrypt input limit used by Supabase Auth.
export const newPasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(72, "Password must be 72 characters or fewer")
  .regex(/[A-Za-z]/, "Password must include a letter")
  .regex(/[0-9]/, "Password must include a number");

export const registerSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(72, "Password is too long"),
});

export const setPasswordSchema = z
  .object({ password: newPasswordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const resendSchema = z.object({ email: emailSchema });

export type FormState = {
  status: "idle" | "error" | "success" | "unverified";
  message?: string;
  email?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

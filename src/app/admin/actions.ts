"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

const reviewSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

export type ReviewResult = { ok: true } | { ok: false; message: string };

const GENERIC_FAILURE: ReviewResult = {
  ok: false,
  message: "That request could not be completed. Refresh the page and try again.",
};

export async function reviewTeacher(input: unknown): Promise<ReviewResult> {
  // 1-2. Valid session and admin, verified server-side (redirects otherwise).
  await requireAdmin();

  // 3. Validate input.
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return GENERIC_FAILURE;
  const { id, decision, reason } = parsed.data;

  // 4-6. The database function re-verifies the admin, requires an instructor
  // that is still pending, requires a verified email to approve, updates the
  // row and writes the audit log in one transaction.
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_instructor", {
    p_target: id,
    p_decision: decision,
    p_reason: decision === "reject" && reason ? reason : null,
  });

  // 7. Safe, generic error.
  if (error) return GENERIC_FAILURE;

  revalidatePath("/admin", "layout");
  return { ok: true };
}

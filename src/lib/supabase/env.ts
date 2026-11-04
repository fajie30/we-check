// Public (browser-safe) Supabase settings. Referenced as literal
// process.env.NEXT_PUBLIC_* so Next can inline them into the client bundle.
// The service-role key is deliberately NOT used anywhere in this app.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local",
  );
}

export const SUPABASE_URL: string = url;
export const SUPABASE_PUBLISHABLE_KEY: string = publishableKey;

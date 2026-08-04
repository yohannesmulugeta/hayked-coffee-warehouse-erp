import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && publishableKey);

export function createSupabaseClient() {
  if (!url || !publishableKey) throw new Error("Supabase environment variables are not configured.");
  return createBrowserClient(url, publishableKey);
}

// Supabase client, created only when the environment is configured.
//
// Why optional? The app is offline-first and must keep working with IndexedDB alone
// (Faz 1-3, and any developer machine without a .env.local). If we called createClient with
// empty strings it would throw at import time and break the whole app, so we skip it instead.
//
// Only the public anon key belongs here. It is safe in browser code because Row Level Security
// in the database decides what a signed-in user may see. The service_role key must never be used.
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const anonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True only when both values exist and are not blank. */
export const isSupabaseConfigured: boolean = Boolean(url?.trim() && anonKey?.trim());

/** The client, or null when Supabase is not configured. Always check before use. */
export const supabase: SupabaseClient | null =
  isSupabaseConfigured && url && anonKey ? createClient(url, anonKey) : null;

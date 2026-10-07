// Supabase is optional: without build-time credentials the app stays device-only.
// The anon/publishable key is safe to ship to the browser because every row is
// protected by row-level security (see supabase/migrations).
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_KEY = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

// http:// is accepted for a local `supabase start` stack.
export const cloudConfigured = /^https?:\/\/.+/.test(SUPABASE_URL) && SUPABASE_KEY.length > 20;

let clientPromise = null;

// supabase-js is loaded on demand so the study screens do not pay for it up front.
export function getSupabaseClient() {
  if (!cloudConfigured) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: "gre-daily-study-auth",
        },
      }),
    );
  }
  return clientPromise;
}

export function authRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

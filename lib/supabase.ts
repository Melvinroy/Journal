import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const supabaseConfig = {
  url: supabaseUrl,
  publishableKey: supabasePublishableKey,
  isConfigured: Boolean(
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) &&
    supabasePublishableKey.startsWith("sb_publishable_")
  ),
};

export const supabase = supabaseConfig.isConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

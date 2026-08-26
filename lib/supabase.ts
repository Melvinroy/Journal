import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://fsccmouzyfgcpqlmcngu.supabase.co";
const supabasePublishableKey = "sb_publishable_Y6vTrdNqLmyZAANBBNGIgg_2mht84P8";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});


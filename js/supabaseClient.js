import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { APP_CONFIG } from "./config.js";

export const supabase = createClient(
  APP_CONFIG.SUPABASE_URL,
  APP_CONFIG.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "ap-auth"
    },
    realtime: { params: { eventsPerSecond: 8 } },
    global: { headers: { "x-application-name": "agency-portal" } }
  }
);

export default supabase;

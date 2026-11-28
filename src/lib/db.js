// The app's one Supabase client: the HintWise template's getSupabase() (src/lib/supabase.ts),
// on the shared HintWise project, scoped to the schema app_ranked_voting, with the PKCE flow.
// The public URL and anon key come from VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
// (netlify.toml [build.environment] on Netlify; a local .env otherwise).
import { getSupabase, hasSupabase } from './supabase'

export const supabaseConfigError = hasSupabase()
  ? null
  : 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env'

export const supabase = supabaseConfigError ? null : getSupabase()

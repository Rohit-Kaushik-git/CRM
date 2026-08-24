/* Public runtime config. The anon key is safe to ship: RLS is the security boundary. */
window.CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
  MODULES: ["TimeTracking", "Payroll", "Benefits", "HR"],
};

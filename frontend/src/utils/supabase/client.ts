import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://khcvklzxfohwkyocenaf.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoY3ZrbHp4Zm9od2t5b2NlbmFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyOTE0ODksImV4cCI6MjA5Mjg2NzQ4OX0.YlqcppDA7xB4ZpOstzjFsnt_0v4nPf09kRXdLf1bCAk";

export const createClient = () =>
  createBrowserClient(
    supabaseUrl,
    supabaseKey,
  );

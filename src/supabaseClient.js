import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://nceyjgayttsaozfqiwtj.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZXlqZ2F5dHRzYW96ZnFpd3RqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MDA1NTAsImV4cCI6MjA5Mjk3NjU1MH0.MtTlxI_fZ5hcVh-IQXT8k0Dp1QvO2J2SgHh009XQXJo";

export const supabase = createClient(supabaseUrl, supabaseKey);
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = 'https://vbvdnxpbaycjxdlwjgnt.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZidmRueHBiYXljanhkbHdqZ250Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0OTQwODUsImV4cCI6MjA4OTA3MDA4NX0.S4ZBDnzdXDAWd98O0klx20BQKTQHA9zl4-Xj6rZvCzU'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

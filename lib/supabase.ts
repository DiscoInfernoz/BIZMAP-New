import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://paublunldzsjvfwvmlgv.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhdWJsdW5sZHpzanZmd3ZtbGd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MDE4OTYsImV4cCI6MjA3MTk3Nzg5Nn0.XWs6bdFnZbNPEgEjW1BKf8MgiCqd_jizUMXwPdsoUUM'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Job = {
  id: string
  user_id?: string
  name: string
  service_date: string
  price: number
  service_type?: string
  lead_source?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  full_address?: string
  lat?: number
  lng?: number
  needs_geocode: boolean
  created_at: string
}
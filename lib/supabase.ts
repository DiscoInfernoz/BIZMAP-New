import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://paublunldzsjvfwvmlgv.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhdWJsdW5sZHpzanZmd3ZtbGd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MDE4OTYsImV4cCI6MjA3MTk3Nzg5Nn0.XWs6bdFnZbNPEgEjW1BKf8MgiCqd_jizUMXwPdsoUUM'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Updated to match your actual database schema
export type Job = {
  id: string
  workspace_id?: string  // This will store the user ID
  customer_name: string
  job_date: string
  revenue: number
  phone?: string
  email?: string
  address_line1?: string
  address_line2?: string
  city?: string
  state?: string
  zip?: string
  latitude?: number
  longitude?: number
  geocode_status?: string
  created_at: string
}

export type UserProfile = {
  id: string
  business_name: string
  phone?: string
  email?: string
  created_at: string
  updated_at: string
}
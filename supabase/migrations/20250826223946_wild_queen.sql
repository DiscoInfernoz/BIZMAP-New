/*
  # Create jobs table for CSV import data

  1. New Tables
    - `jobs`
      - `id` (uuid, primary key)
      - `user_id` (uuid, nullable for guest uploads)
      - `name` (text, required - customer name)
      - `service_date` (date, required)
      - `price` (numeric, required)
      - `service_type` (text, optional)
      - `lead_source` (text, optional)
      - `street` (text, optional if full_address provided)
      - `city` (text, optional if full_address provided)
      - `state` (text, optional if full_address provided)
      - `zip` (text, optional if full_address provided)
      - `full_address` (text, optional if components provided)
      - `lat` (double precision, for geocoding results)
      - `lng` (double precision, for geocoding results)
      - `needs_geocode` (boolean, default false)
      - `created_at` (timestamptz, default now())

  2. Security
    - Enable RLS on `jobs` table
    - Add policy for authenticated users to manage their own data
    - Add policy for anonymous users to insert data (for guest uploads)
*/

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  service_date date NOT NULL,
  price numeric NOT NULL,
  service_type text,
  lead_source text,
  street text,
  city text,
  state text,
  zip text,
  full_address text,
  lat double precision,
  lng double precision,
  needs_geocode boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to manage their own jobs
CREATE POLICY "Users can manage own jobs"
  ON jobs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow anonymous users to insert jobs (for guest uploads)
CREATE POLICY "Anonymous users can insert jobs"
  ON jobs
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

-- Allow anonymous users to read jobs they just created (optional, for confirmation)
CREATE POLICY "Anonymous users can read recent jobs"
  ON jobs
  FOR SELECT
  TO anon
  USING (user_id IS NULL AND created_at > now() - interval '1 hour');
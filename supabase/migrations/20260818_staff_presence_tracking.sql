-- Add presence tracking columns to staff table

-- Add last_activity column if it doesn't exist
ALTER TABLE IF EXISTS staff ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP DEFAULT NOW();

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_staff_last_activity ON staff(last_activity DESC);

-- Enable RLS on staff table if not already enabled
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

-- RLS policy to allow reading staff presence
CREATE POLICY IF NOT EXISTS "Allow authenticated users to read staff presence" ON staff
  FOR SELECT
  USING (auth.role() = 'authenticated');

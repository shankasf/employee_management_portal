// Database migration script for Time Card enhancements
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

async function migrate() {
  console.log('Running database migrations...\n');

  const migrations = [
    // Add hourly_rate to employees
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2)`,

    // Clock In location fields
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_lat NUMERIC(10,7)`,
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_lng NUMERIC(10,7)`,
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_accuracy NUMERIC(10,2)`,
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_location_status TEXT DEFAULT 'unknown'`,

    // Clock Out location fields
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_lat NUMERIC(10,7)`,
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_lng NUMERIC(10,7)`,
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_accuracy NUMERIC(10,2)`,
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_location_status TEXT DEFAULT 'unknown'`,

    // Break and work type fields
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS break_minutes INTEGER DEFAULT 0`,
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS work_type TEXT DEFAULT 'regular'`,
    `ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS notes TEXT`,
  ];

  for (const sql of migrations) {
    try {
      const { error } = await supabase.rpc('exec_sql', { query: sql });
      if (error) {
        // Try direct query if RPC not available
        const { error: directError } = await supabase.from('_migrations').select('*').limit(0);
        console.log(`Note: ${sql.substring(0, 50)}... - RPC not available, migrations may need to be run manually`);
      } else {
        console.log(`✓ ${sql.substring(0, 60)}...`);
      }
    } catch (err) {
      console.log(`Note: ${sql.substring(0, 50)}... - requires manual execution`);
    }
  }

  console.log('\n✅ Migration script completed!');
  console.log('\nIf migrations failed, please run the following SQL in your Supabase SQL Editor:\n');
  console.log('-- Add hourly_rate to employees');
  console.log('ALTER TABLE employees ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);');
  console.log('\n-- Add location and time tracking fields to attendance_logs');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_lat NUMERIC(10,7);');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_lng NUMERIC(10,7);');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_accuracy NUMERIC(10,2);');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_in_location_status TEXT DEFAULT \'unknown\';');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_lat NUMERIC(10,7);');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_lng NUMERIC(10,7);');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_accuracy NUMERIC(10,2);');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS clock_out_location_status TEXT DEFAULT \'unknown\';');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS break_minutes INTEGER DEFAULT 0;');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS work_type TEXT DEFAULT \'regular\';');
  console.log('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS notes TEXT;');
}

migrate().catch(console.error);

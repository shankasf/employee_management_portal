// Migration script: Move profile pictures from employee-docs to public profile-pictures bucket
// Run once after creating the profile-pictures bucket:
//   node scripts/migrate-profile-pictures.js

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

async function migrate() {
  console.log('Migrating profile pictures to public bucket...\n');

  // 1. Ensure the public bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(b => b.id === 'profile-pictures');

  if (!bucketExists) {
    console.log('Creating profile-pictures bucket...');
    const { error } = await supabase.storage.createBucket('profile-pictures', {
      public: true
    });
    if (error) {
      console.error('Failed to create bucket:', error.message);
      process.exit(1);
    }
    console.log('Created profile-pictures bucket (public)\n');
  } else {
    console.log('profile-pictures bucket already exists\n');
  }

  // 2. Find all employees with profile pictures in the old bucket
  const { data: employees, error: fetchError } = await supabase
    .from('employees')
    .select('id, display_name, profile_picture_url')
    .not('profile_picture_url', 'is', null);

  if (fetchError) {
    console.error('Failed to fetch employees:', fetchError.message);
    process.exit(1);
  }

  if (!employees || employees.length === 0) {
    console.log('No employees with profile pictures to migrate.');
    return;
  }

  console.log(`Found ${employees.length} employee(s) with profile pictures to migrate.\n`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const emp of employees) {
    const oldPath = emp.profile_picture_url;

    // Skip if it's already a full URL (external avatar) or doesn't look like an old path
    if (oldPath.startsWith('http://') || oldPath.startsWith('https://')) {
      console.log(`  [SKIP] ${emp.display_name || emp.id}: External URL, no migration needed`);
      skipped++;
      continue;
    }

    // Old path format: "profile-pictures/profile_<id>_<timestamp>.<ext>"
    // New path format: "profile_<id>_<timestamp>.<ext>" (just the filename, bucket is separate)
    const fileName = oldPath.includes('/') ? oldPath.split('/').pop() : oldPath;

    try {
      // Download from old bucket
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('employee-docs')
        .download(oldPath);

      if (downloadError) {
        console.log(`  [SKIP] ${emp.display_name || emp.id}: File not in old bucket (${downloadError.message})`);
        skipped++;
        continue;
      }

      // Upload to new public bucket
      const { error: uploadError } = await supabase.storage
        .from('profile-pictures')
        .upload(fileName, fileData, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        console.error(`  [FAIL] ${emp.display_name || emp.id}: Upload failed (${uploadError.message})`);
        failed++;
        continue;
      }

      // Update the employee record to point to new path (just the filename)
      const { error: updateError } = await supabase
        .from('employees')
        .update({ profile_picture_url: fileName })
        .eq('id', emp.id);

      if (updateError) {
        console.error(`  [FAIL] ${emp.display_name || emp.id}: DB update failed (${updateError.message})`);
        failed++;
        continue;
      }

      console.log(`  [OK]   ${emp.display_name || emp.id}: ${oldPath} -> ${fileName}`);
      migrated++;

    } catch (err) {
      console.error(`  [FAIL] ${emp.display_name || emp.id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped, ${failed} failed`);
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});

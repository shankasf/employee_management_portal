require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function run() {
  const { data, error } = await supabase
    .from("task_instances")
    .select("id, task_id, scheduled_date, status, completed_at, video_url, video_urls, photo_url, photo_urls, notes, employee_id, tasks(title, requires_video, requires_photo)")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(50);

  if (error) { console.error("Error:", error); return; }

  console.log("=== COMPLETED TASKS ===");
  console.log("Total completed:", data.length);
  console.log("");

  let missingVideoCount = 0;
  let missingPhotoCount = 0;

  for (const t of data) {
    const hasVideo = t.video_url || (t.video_urls && t.video_urls.length > 0);
    const hasPhoto = t.photo_url || (t.photo_urls && t.photo_urls.length > 0);
    const reqVideo = t.tasks ? t.tasks.requires_video : false;
    const reqPhoto = t.tasks ? t.tasks.requires_photo : false;

    const videoMissing = reqVideo && !hasVideo;
    const photoMissing = reqPhoto && !hasPhoto;

    if (videoMissing) missingVideoCount++;
    if (photoMissing) missingPhotoCount++;

    console.log("---");
    console.log("Task:", t.tasks ? t.tasks.title : "Unknown");
    console.log("ID:", t.id);
    console.log("Date:", t.scheduled_date, "| Completed:", t.completed_at);
    console.log("Requires video:", reqVideo, "| Has video:", !!hasVideo);
    console.log("  video_url:", t.video_url || "null");
    console.log("  video_urls:", JSON.stringify(t.video_urls));
    console.log("Requires photo:", reqPhoto, "| Has photo:", !!hasPhoto);
    console.log("  photo_url:", t.photo_url || "null");
    console.log("  photo_urls:", JSON.stringify(t.photo_urls));
    if (videoMissing) {
      console.log("  *** MISSING VIDEO - required but not uploaded! ***");
    }
    if (photoMissing) {
      console.log("  *** MISSING PHOTO - required but not uploaded! ***");
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log("Total completed tasks:", data.length);
  console.log("Missing required videos:", missingVideoCount);
  console.log("Missing required photos:", missingPhotoCount);

  // Also check what's in the storage bucket
  console.log("\n=== STORAGE BUCKET FILES ===");
  const { data: files, error: storageError } = await supabase.storage
    .from("task-media")
    .list("", { limit: 100 });

  if (storageError) {
    console.log("Storage error:", storageError.message);
  } else {
    console.log("Top-level folders/files:", files.length);
    for (const f of files) {
      if (f.id) {
        console.log("  File:", f.name);
      } else {
        // It's a folder (user ID), list its contents
        const { data: userFiles } = await supabase.storage
          .from("task-media")
          .list(f.name, { limit: 50 });
        const videoFiles = (userFiles || []).filter(uf => uf.name.includes("video"));
        const photoFiles = (userFiles || []).filter(uf => uf.name.includes("photo"));
        console.log("  Folder:", f.name, "- Videos:", videoFiles.length, "Photos:", photoFiles.length);
        for (const vf of videoFiles) {
          console.log("    Video:", vf.name, "Size:", vf.metadata ? vf.metadata.size : "unknown");
        }
      }
    }
  }
}

run();

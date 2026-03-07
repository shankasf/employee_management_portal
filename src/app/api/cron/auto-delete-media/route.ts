import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logActivity } from '@/lib/activity-log'

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Extract the storage path from a URL or raw path.
 */
function extractStoragePath(urlOrPath: string): string | null {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null

  try {
    const url = new URL(urlOrPath)
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/task-media\/(.+)/)
    if (match) return match[1]
  } catch {
    // Not a URL, treat as raw path
  }

  if (urlOrPath.startsWith('task-media/')) {
    return urlOrPath.slice('task-media/'.length)
  }

  return urlOrPath
}

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret) {
      console.error('[auto-delete-media] CRON_SECRET not configured')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()

    // Find completed task instances older than 72 hours with media still present
    const { data: instances, error: fetchError } = await supabaseAdmin
      .from('task_instances')
      .select('id, task_id, employee_id, photo_url, photo_urls, video_url, video_urls, tasks(title), employees(display_name)')
      .eq('status', 'completed')
      .is('media_deleted_at', null)
      .lt('completed_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString())
      .or('photo_url.not.is.null,photo_urls.not.is.null,video_url.not.is.null,video_urls.not.is.null')
      .limit(100)

    if (fetchError) {
      console.error('[auto-delete-media] Fetch error:', fetchError.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    let totalDeleted = 0
    let totalFilesRemoved = 0

    for (const instance of (instances || [])) {
      // Collect all media paths
      const allPaths: string[] = []
      const mediaFields = [
        instance.photo_url,
        ...(instance.photo_urls || []),
        instance.video_url,
        ...(instance.video_urls || []),
      ]

      for (const field of mediaFields) {
        if (field && typeof field === 'string') {
          const path = extractStoragePath(field)
          if (path) allPaths.push(path)
        }
      }

      // Delete files from storage in batches of 100
      let filesRemoved = 0
      if (allPaths.length > 0) {
        const uniquePaths = Array.from(new Set(allPaths))
        for (let i = 0; i < uniquePaths.length; i += 100) {
          const batch = uniquePaths.slice(i, i + 100)
          const { data: removeData, error: removeError } = await supabaseAdmin.storage
            .from('task-media')
            .remove(batch)
          if (removeError) {
            console.error(`[auto-delete-media] Storage remove error for instance ${instance.id}:`, removeError.message)
          } else {
            filesRemoved += removeData?.length || 0
          }
        }
      }

      // Update DB: null out media columns, set deletion metadata
      const { error: updateError } = await supabaseAdmin
        .from('task_instances')
        .update({
          photo_url: null,
          photo_urls: null,
          video_url: null,
          video_urls: null,
          media_deleted_at: new Date().toISOString(),
          media_deleted_by: null,
          media_deleted_by_name: 'Media automatically deleted after 72 hrs',
        })
        .eq('id', instance.id)

      if (updateError) {
        console.error(`[auto-delete-media] Update error for instance ${instance.id}:`, updateError.message)
        continue
      }

      // Log activity
      const taskTitle = (instance.tasks as { title?: string } | null)?.title || 'Unknown'
      const employeeName = (instance.employees as { display_name?: string } | null)?.display_name || 'Unknown'

      await logActivity({
        adminId: null,
        adminEmail: 'system (auto-delete cron)',
        action: 'task_media_auto_deleted',
        entityType: 'task_instance',
        entityId: instance.id,
        entityName: `${taskTitle} - ${employeeName}`,
        details: {
          task_id: instance.task_id,
          employee_id: instance.employee_id,
          files_removed: filesRemoved,
        },
      })

      totalDeleted++
      totalFilesRemoved += filesRemoved
    }

    // --- Phase 2: Delete reference media from tasks ---
    // Find tasks that have reference media and where ALL instances are 72h+ completed with media already cleaned
    let refTasksCleaned = 0
    let refFilesRemoved = 0

    const { data: tasksWithRefs, error: refFetchError } = await supabaseAdmin
      .from('tasks')
      .select('id, title, reference_images, reference_videos')
      .or('reference_images.not.is.null,reference_videos.not.is.null')
      .limit(100)

    if (refFetchError) {
      console.error('[auto-delete-media] Reference media fetch error:', refFetchError.message)
    } else if (tasksWithRefs && tasksWithRefs.length > 0) {
      for (const task of tasksWithRefs) {
        const hasRefImages = task.reference_images && task.reference_images.length > 0
        const hasRefVideos = task.reference_videos && task.reference_videos.length > 0
        if (!hasRefImages && !hasRefVideos) continue

        // Check if any instance still has uncleaned media or is not yet 72h completed
        const { count: uncleanedCount, error: countError } = await supabaseAdmin
          .from('task_instances')
          .select('id', { count: 'exact', head: true })
          .eq('task_id', task.id)
          .or('media_deleted_at.is.null')

        if (countError) {
          console.error(`[auto-delete-media] Count error for task ${task.id}:`, countError.message)
          continue
        }

        // Skip if any instances still have uncleaned media
        if (uncleanedCount && uncleanedCount > 0) continue

        // All instances are cleaned — delete reference files from storage
        const refPaths: string[] = []
        for (const field of [...(task.reference_images || []), ...(task.reference_videos || [])]) {
          if (field && typeof field === 'string') {
            const path = extractStoragePath(field)
            if (path) refPaths.push(path)
          }
        }

        let filesRemoved = 0
        if (refPaths.length > 0) {
          const uniquePaths = Array.from(new Set(refPaths))
          for (let i = 0; i < uniquePaths.length; i += 100) {
            const batch = uniquePaths.slice(i, i + 100)
            const { data: removeData, error: removeError } = await supabaseAdmin.storage
              .from('task-media')
              .remove(batch)
            if (removeError) {
              console.error(`[auto-delete-media] Ref storage remove error for task ${task.id}:`, removeError.message)
            } else {
              filesRemoved += removeData?.length || 0
            }
          }
        }

        // Null out reference media columns on the task
        const { error: updateError } = await supabaseAdmin
          .from('tasks')
          .update({
            reference_images: null,
            reference_videos: null,
          })
          .eq('id', task.id)

        if (updateError) {
          console.error(`[auto-delete-media] Ref update error for task ${task.id}:`, updateError.message)
          continue
        }

        await logActivity({
          adminId: null,
          adminEmail: 'system (auto-delete cron)',
          action: 'task_media_auto_deleted',
          entityType: 'task',
          entityId: task.id,
          entityName: `${task.title} (reference media)`,
          details: {
            reference_images_removed: task.reference_images?.length || 0,
            reference_videos_removed: task.reference_videos?.length || 0,
            files_removed: filesRemoved,
          },
        })

        refTasksCleaned++
        refFilesRemoved += filesRemoved
      }
    }

    console.log(`[auto-delete-media] Instances: ${totalDeleted} cleaned, ${totalFilesRemoved} files. References: ${refTasksCleaned} tasks cleaned, ${refFilesRemoved} files.`)

    return NextResponse.json({
      deleted: totalDeleted,
      filesRemoved: totalFilesRemoved,
      referenceTasksCleaned: refTasksCleaned,
      referenceFilesRemoved: refFilesRemoved,
    })
  } catch (err) {
    console.error('[auto-delete-media] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

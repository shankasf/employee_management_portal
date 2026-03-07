import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { logActivity, getRequestInfo } from '@/lib/activity-log'

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()

    // Admin role check
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, full_name, email')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse and validate body
    const body = await request.json()
    const { instanceIds } = body as { instanceIds: string[] }

    if (!Array.isArray(instanceIds) || instanceIds.length === 0) {
      return NextResponse.json({ error: 'instanceIds must be a non-empty array' }, { status: 400 })
    }

    if (instanceIds.length > 200) {
      return NextResponse.json({ error: 'Maximum 200 instances per request' }, { status: 400 })
    }

    // Validate all IDs are UUIDs
    for (const id of instanceIds) {
      if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
        return NextResponse.json({ error: 'Invalid instance ID format' }, { status: 400 })
      }
    }

    // Fetch instances before deleting (for logging and to confirm they exist)
    const { data: instances, error: fetchError } = await supabaseAdmin
      .from('task_instances')
      .select('id, task_id, employee_id, scheduled_date, status, tasks(title), employees(display_name)')
      .in('id', instanceIds)

    if (fetchError) {
      console.error('[bulk-delete] Fetch error:', fetchError.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    if (!instances || instances.length === 0) {
      return NextResponse.json({ error: 'No matching task instances found' }, { status: 404 })
    }

    const idsToDelete = instances.map(i => i.id)

    // Fetch media info for storage cleanup
    const { data: mediaInstances } = await supabaseAdmin
      .from('task_instances')
      .select('id, photo_url, photo_urls, video_url, video_urls')
      .in('id', idsToDelete)

    // Collect storage paths for cleanup
    const allPaths: string[] = []
    if (mediaInstances) {
      for (const instance of mediaInstances) {
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
      }
    }

    // Delete media files from storage
    let filesRemoved = 0
    if (allPaths.length > 0) {
      const uniquePaths = Array.from(new Set(allPaths))
      for (let i = 0; i < uniquePaths.length; i += 100) {
        const batch = uniquePaths.slice(i, i + 100)
        const { data: removeData, error: removeError } = await supabaseAdmin.storage
          .from('task-media')
          .remove(batch)
        if (removeError) {
          console.error('[bulk-delete] Storage remove error:', removeError.message)
        } else {
          filesRemoved += removeData?.length || 0
        }
      }
    }

    // Delete from database using service role
    const { error: deleteError } = await supabaseAdmin
      .from('task_instances')
      .delete()
      .in('id', idsToDelete)

    if (deleteError) {
      console.error('[bulk-delete] Delete error:', deleteError.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    // Verify deletion
    const { data: remaining } = await supabaseAdmin
      .from('task_instances')
      .select('id')
      .in('id', idsToDelete)

    const actuallyDeleted = idsToDelete.length - (remaining?.length || 0)

    // Log activity
    const { ipAddress, userAgent } = getRequestInfo(request.headers)
    const deletedInfo = instances.map(i => ({
      task_name: (i.tasks as { title?: string } | null)?.title || 'Unknown',
      employee_name: (i.employees as { display_name?: string } | null)?.display_name || 'Unknown',
      scheduled_date: i.scheduled_date,
      status: i.status,
    }))

    await logActivity({
      adminId: user.id,
      adminEmail: profile.email || user.email || 'unknown',
      action: 'task_instances_bulk_deleted',
      entityType: 'task_instance',
      entityId: idsToDelete[0],
      entityName: `${actuallyDeleted} task instance(s)`,
      details: {
        count: actuallyDeleted,
        files_removed: filesRemoved,
        instances: deletedInfo,
      },
      ipAddress,
      userAgent,
    })

    return NextResponse.json({
      success: true,
      deleted: actuallyDeleted,
      filesRemoved,
    })
  } catch (err) {
    console.error('[bulk-delete] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
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

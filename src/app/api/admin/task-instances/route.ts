import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated and is admin
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createAdminClient()

    // Check if user is admin
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get query params
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const status = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')

    // Build query using service role (bypasses RLS)
    let query = supabaseAdmin
      .from('task_instances')
      .select(`
        id,
        task_id,
        employee_id,
        scheduled_date,
        status,
        completed_at,
        notes,
        photo_url,
        photo_urls,
        video_url,
        video_urls,
        media_deleted_at,
        media_deleted_by,
        media_deleted_by_name,
        created_at,
        tasks (
          id,
          title,
          description,
          location,
          cutoff_time,
          is_recurring,
          frequency,
          requires_photo,
          requires_video,
          requires_notes,
          reference_images,
          reference_videos
        ),
        employees (
          id,
          display_name,
          position,
          profiles (
            email,
            full_name
          )
        )
      `)
      .order('scheduled_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (startDate) {
      query = query.gte('scheduled_date', startDate)
    }
    if (endDate) {
      query = query.lte('scheduled_date', endDate)
    }
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    if (employeeId && employeeId !== 'all') {
      query = query.eq('employee_id', employeeId)
    }

    const { data, error } = await query.limit(500)

    if (error) {
      console.error('[task-instances API] Error:', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('[task-instances API] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// GET — fetch a single active policy (employees only see active ones)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any
  const { data, error } = await supabase
    .from('policy_strips')
    .select('id, title, content, category, image_url, video_url, is_active')
    .eq('id', id)
    .single()

  if (error || !data || !data.is_active) {
    return NextResponse.json({ error: 'Policy not found' }, { status: 404 })
  }

  return NextResponse.json({ policy: data })
}

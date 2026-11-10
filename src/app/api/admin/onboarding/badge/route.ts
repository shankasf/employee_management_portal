import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// GET — count of unacknowledged completions for admin badge
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if ((profile as { role: string } | null)?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa = (await createServiceClient()) as any
  const { count, error } = await supa
    .from('onboarding_completions')
    .select('id', { count: 'exact', head: true })
    .eq('acknowledged_by_admin', false)

  if (error) {
    console.error('[admin onboarding badge]', error)
    return NextResponse.json({ count: 0 })
  }
  return NextResponse.json({ count: count || 0 })
}

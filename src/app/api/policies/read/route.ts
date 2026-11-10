import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// POST { policy_id }
// Records the current employee acknowledging an important message.
// Idempotent: re-marking is a no-op.
export async function POST(request: Request) {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { policy_id?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!body.policy_id || typeof body.policy_id !== 'string') {
    return NextResponse.json({ error: 'policy_id required' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  // Confirm the strip exists (and is active — silently allow inactive too,
  // so a strip that becomes inactive while open in the UI still resolves).
  const { data: strip, error: stripErr } = await supabase
    .from('policy_strips')
    .select('id')
    .eq('id', body.policy_id)
    .maybeSingle()

  if (stripErr || !strip) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  const { error: insertErr } = await supabase
    .from('policy_strip_reads')
    .upsert(
      { policy_strip_id: body.policy_id, employee_id: user.id, read_at: new Date().toISOString() },
      { onConflict: 'policy_strip_id,employee_id', ignoreDuplicates: false }
    )

  if (insertErr) {
    console.error('[policies/read] insert', insertErr)
    return NextResponse.json({ error: 'Failed to mark as read' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

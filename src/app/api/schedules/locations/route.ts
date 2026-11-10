import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// GET — list scheduling locations sourced from the businesses table.
// Returns labels in the form "Name - Location" (e.g. "Toy Republic - Crossgates Mall").
// Any authenticated user (admin or employee) may read these.
export async function GET() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createServiceClient()) as any

  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, location')
    .not('location', 'is', null)
    .order('name', { ascending: true })
    .order('location', { ascending: true })

  if (error) {
    console.error('[schedules locations]', error.message)
    return NextResponse.json({ error: 'Failed to load locations' }, { status: 500 })
  }

  const locations = ((data as Array<{ id: number; name: string; location: string | null }>) || [])
    .map(b => ({
      id: b.id,
      name: b.name,
      location: b.location,
      label: b.location ? `${b.name} - ${b.location}` : b.name,
    }))

  return NextResponse.json({ locations })
}

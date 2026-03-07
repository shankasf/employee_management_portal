import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lat = request.nextUrl.searchParams.get('lat')
  const lng = request.nextUrl.searchParams.get('lng')

  if (!lat || !lng || isNaN(Number(lat)) || isNaN(Number(lng))) {
    return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 })
  }

  // Clamp to valid range
  const latNum = Math.max(-90, Math.min(90, Number(lat)))
  const lngNum = Math.max(-180, Math.min(180, Number(lng)))

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latNum}&lon=${lngNum}&format=json&zoom=18&addressdetails=1`,
      { headers: { 'User-Agent': 'PlayFuniaEmployeeMgmt/1.0' }, next: { revalidate: 86400 } }
    )
    if (!res.ok) throw new Error('Nominatim request failed')

    const data = await res.json()
    const addr = data.address || {}

    // Build a precise, short label: prefer road/neighbourhood, then suburb, then city
    const road = addr.road || ''
    const neighbourhood = addr.neighbourhood || addr.suburb || ''
    const city = addr.city || addr.town || addr.village || addr.hamlet || ''

    let label = ''
    if (road && neighbourhood) {
      label = `${road}, ${neighbourhood}`
    } else if (road && city) {
      label = `${road}, ${city}`
    } else if (neighbourhood && city) {
      label = `${neighbourhood}, ${city}`
    } else if (road) {
      label = road
    } else if (neighbourhood) {
      label = neighbourhood
    } else if (city) {
      label = city
    } else {
      label = data.display_name?.split(',').slice(0, 2).join(',').trim() || `${latNum.toFixed(4)}, ${lngNum.toFixed(4)}`
    }

    return NextResponse.json({ location: label })
  } catch {
    return NextResponse.json({ location: `${latNum.toFixed(4)}, ${lngNum.toFixed(4)}` })
  }
}

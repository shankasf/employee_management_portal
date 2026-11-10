import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Server-side geocode cache (survives across requests in the same process)
const serverGeocodeCache = new Map<string, string>()

// Throttle: serialize Nominatim calls with a delay to avoid 429
let lastNominatimCall = 0
const NOMINATIM_DELAY_MS = 1100 // Nominatim asks for max 1 req/sec

async function throttledNominatimFetch(url: string): Promise<Response> {
  const now = Date.now()
  const wait = Math.max(0, NOMINATIM_DELAY_MS - (now - lastNominatimCall))
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait))
  }
  lastNominatimCall = Date.now()
  return fetch(url, {
    headers: { 'User-Agent': 'PlayFuniaEmployeeMgmt/1.0' },
    next: { revalidate: 86400 },
  })
}

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

  // Check server cache first (rounded to 3 decimal places)
  const cacheKey = `${latNum.toFixed(3)},${lngNum.toFixed(3)}`
  const cached = serverGeocodeCache.get(cacheKey)
  if (cached) {
    return NextResponse.json({ location: cached })
  }

  try {
    const res = await throttledNominatimFetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latNum}&lon=${lngNum}&format=json&zoom=18&addressdetails=1`
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

    // Only cache real location names, not numeric fallbacks
    if (label && !/^\d/.test(label)) {
      serverGeocodeCache.set(cacheKey, label)
    }

    return NextResponse.json({ location: label })
  } catch {
    return NextResponse.json({ location: `${latNum.toFixed(4)}, ${lngNum.toFixed(4)}` })
  }
}

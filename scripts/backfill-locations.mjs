const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY // never hardcode

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
}

async function supabaseGet(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers })
  if (!res.ok) throw new Error(`Supabase GET error: ${res.status}`)
  return res.json()
}

async function supabasePatch(table, id, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH', headers, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase PATCH error: ${res.status}`)
}

async function geocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`
  const res = await fetch(url, { headers: { 'User-Agent': 'PlayFuniaEmployeeMgmt/1.0' } })
  if (!res.ok) return null
  const data = await res.json()
  const addr = data.address || {}
  const road = addr.road || ''
  const neighbourhood = addr.neighbourhood || addr.suburb || ''
  const city = addr.city || addr.town || addr.village || addr.hamlet || ''
  if (road && neighbourhood) return `${road}, ${neighbourhood}`
  if (road && city) return `${road}, ${city}`
  if (neighbourhood && city) return `${neighbourhood}, ${city}`
  if (road) return road
  if (neighbourhood) return neighbourhood
  if (city) return city
  return data.display_name?.split(',').slice(0, 2).join(',').trim() || null
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const cache = new Map()

async function resolve(lat, lng) {
  const key = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`
  if (cache.has(key)) return cache.get(key)
  await sleep(1100)
  const name = await geocode(lat, lng)
  if (name) cache.set(key, name)
  return name
}

async function main() {
  // Get rows needing clock_in location
  const needIn = await supabaseGet('attendance_logs',
    'select=id,clock_in_lat,clock_in_lng&clock_in_lat=not.is.null&clock_in_location_name=is.null&clock_in_location_status=eq.captured')
  console.log(`Resolving ${needIn.length} clock-in locations...`)

  for (let i = 0; i < needIn.length; i++) {
    const row = needIn[i]
    const name = await resolve(row.clock_in_lat, row.clock_in_lng)
    if (name) await supabasePatch('attendance_logs', row.id, { clock_in_location_name: name })
    if ((i + 1) % 10 === 0) console.log(`  clock-in: ${i + 1}/${needIn.length}`)
  }
  console.log(`  clock-in: ${needIn.length}/${needIn.length} done`)

  // Get rows needing clock_out location
  const needOut = await supabaseGet('attendance_logs',
    'select=id,clock_out_lat,clock_out_lng&clock_out_lat=not.is.null&clock_out_location_name=is.null&clock_out_location_status=eq.captured')
  console.log(`Resolving ${needOut.length} clock-out locations...`)

  for (let i = 0; i < needOut.length; i++) {
    const row = needOut[i]
    const name = await resolve(row.clock_out_lat, row.clock_out_lng)
    if (name) await supabasePatch('attendance_logs', row.id, { clock_out_location_name: name })
    if ((i + 1) % 10 === 0) console.log(`  clock-out: ${i + 1}/${needOut.length}`)
  }
  console.log(`  clock-out: ${needOut.length}/${needOut.length} done`)

  console.log(`Finished! Resolved ${cache.size} unique locations.`)
}

main().catch(e => { console.error(e); process.exit(1) })

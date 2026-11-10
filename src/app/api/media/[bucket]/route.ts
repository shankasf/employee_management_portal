import { NextResponse } from 'next/server'
import { createClient, createUntypedServiceClient } from '@/lib/supabase/server'
import { isProxiedBucket, toStoragePath } from '@/lib/storage-path'

/**
 * Authenticated media proxy for the private storage buckets.
 *
 * profile-pictures, onboarding-content and policy-media were public buckets,
 * which meant every object in them was fetchable by anyone holding a URL. They
 * are private now; this route checks for a session and redirects to a
 * short-lived signed URL, so browsers still get a plain URL they can put in an
 * <img>/<video>/<a> and the render paths stay synchronous.
 *
 * Every signed-in employee may read these three buckets, which is the access
 * the storage policies already granted (org charts show every colleague's
 * avatar; onboarding_storage_read_authenticated covers onboarding content).
 * This narrows access from "anyone on the internet" to "signed-in staff"; it
 * does not widen anything.
 */

const SIGNED_URL_TTL_SECONDS = 3600

// Well inside the signature lifetime, so a cached redirect can never outlive
// the URL it points at. Keeps a 46-avatar org chart from re-signing per render.
const REDIRECT_CACHE_SECONDS = 300

export async function GET(
  request: Request,
  { params }: { params: Promise<{ bucket: string }> },
) {
  const { bucket } = await params

  if (!isProxiedBucket(bucket)) {
    return NextResponse.json({ error: 'Unknown bucket' }, { status: 404 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = new URL(request.url).searchParams.get('u')
  const path = toStoragePath(bucket, raw)
  if (!path) {
    return NextResponse.json({ error: 'Invalid object reference' }, { status: 400 })
  }

  const serviceClient = await createUntypedServiceClient()
  const { data, error } = await serviceClient.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const response = NextResponse.redirect(data.signedUrl, 302)
  response.headers.set('Cache-Control', `private, max-age=${REDIRECT_CACHE_SECONDS}`)
  return response
}

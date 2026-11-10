/**
 * Helpers for referencing objects in the private storage buckets.
 *
 * `profile-pictures`, `onboarding-content` and `policy-media` used to be public
 * buckets, so anyone holding an object URL could fetch it without a session.
 * They are private now, and the objects are reached through the authenticated
 * proxy at /api/media/[bucket], which redirects to a short-lived signed URL.
 *
 * Stored column values are inconsistent by history:
 *   - employees.profile_picture_url  -> a bare object path ("profile_<uuid>_x.png"),
 *     or a full external URL for Google/OAuth avatars
 *   - onboarding_content.content_url -> a full ".../object/public/<bucket>/<path>"
 *     URL, or an arbitrary external link an admin pasted in
 *   - policy_strips.image_url / video_url -> same shape as content_url
 *
 * `toStoragePath` normalises the first two shapes and returns null for anything
 * that belongs somewhere else, so callers can pass a raw column value straight
 * in. These functions are pure and safe to import from client components.
 */

export const PROXIED_BUCKETS = [
  'profile-pictures',
  'onboarding-content',
  'policy-media',
] as const;

export type ProxiedBucket = (typeof PROXIED_BUCKETS)[number];

export function isProxiedBucket(value: string): value is ProxiedBucket {
  return (PROXIED_BUCKETS as readonly string[]).includes(value);
}

const OBJECT_MARKER = '/storage/v1/object/';

/**
 * Resolve a stored column value to an object path inside `bucket`.
 * Returns null when the value points at some other host or bucket.
 */
export function toStoragePath(
  bucket: string,
  urlOrPath: string | null | undefined,
): string | null {
  if (!urlOrPath) return null;

  let candidate = urlOrPath;

  if (candidate.includes(OBJECT_MARKER)) {
    // .../storage/v1/object/{public|sign|authenticated}/{bucket}/{path}[?token=]
    const after = candidate.split(OBJECT_MARKER)[1];
    if (!after) return null;
    const withoutQuery = after.split('?')[0] ?? '';
    const slash = withoutQuery.indexOf('/');
    if (slash === -1) return null;
    const rest = withoutQuery.slice(slash + 1); // drop the access-type segment
    if (!rest.startsWith(`${bucket}/`)) return null; // a different bucket
    candidate = decodeSafely(rest.slice(bucket.length + 1));
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    // An external link (a pasted YouTube URL, an OAuth avatar) - not ours.
    return null;
  }

  return sanitisePath(candidate);
}

/**
 * Build the src/href to use for a stored column value. Object references become
 * proxy URLs; external links are handed back untouched so pasted links keep
 * working. Synchronous, so render paths do not have to become async.
 */
export function getMediaSrc(
  bucket: ProxiedBucket,
  urlOrPath: string | null | undefined,
): string | null {
  if (!urlOrPath) return null;

  const path = toStoragePath(bucket, urlOrPath);
  if (!path) {
    // Only hand back things that are actually fetchable by a browser.
    return /^https?:\/\//i.test(urlOrPath) ? urlOrPath : null;
  }

  return `/api/media/${bucket}?u=${encodeURIComponent(path)}`;
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Storage keys are not filesystem paths, but refuse traversal-looking and
 * absolute keys anyway rather than forwarding them to the storage API.
 */
function sanitisePath(path: string): string | null {
  const trimmed = path.replace(/^\/+/, '').trim();
  if (!trimmed) return null;
  if (trimmed.split('/').some(segment => segment === '.' || segment === '..')) {
    return null;
  }
  return trimmed;
}

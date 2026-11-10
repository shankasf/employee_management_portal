import { createUntypedServiceClient } from '@/lib/supabase/server'

/**
 * Service-role client for the calendar tables.
 *
 * The generated `Database` type in this project does not support typed writes
 * (inserts resolve to `never`), which is why the rest of the codebase reaches
 * for the untyped service client whenever it needs to write. Calendar code goes
 * through this one helper so the escape hatch is in a single, documented place.
 *
 * Callers still cast query results to the row interfaces in ./types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function calendarDb(): Promise<any> {
  return createUntypedServiceClient()
}

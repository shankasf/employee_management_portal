import { NextRequest } from 'next/server'
import { handleOAuthCallback } from '@/lib/calendar/oauth-callback'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return handleOAuthCallback(request, 'google')
}

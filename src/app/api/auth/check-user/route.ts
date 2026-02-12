import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
    try {
        // Require authentication
        const sessionClient = await createClient()
        const { data: { user } } = await sessionClient.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Require admin role
        const supabase = await createServiceClient()
        const { data: adminProfile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        if ((adminProfile as { role: string } | null)?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { email } = await request.json()

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 })
        }

        // Check if user exists in profiles table
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', email.toLowerCase())
            .single()

        return NextResponse.json({
            exists: !error && !!profile
        })

    } catch (error) {
        console.error('Error checking user:', error)
        return NextResponse.json({
            error: 'Internal server error'
        }, { status: 500 })
    }
}

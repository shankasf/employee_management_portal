import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
    try {
        const { email } = await request.json()

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 })
        }

        const supabase = await createServiceClient()

        // Check if user exists in profiles table
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', email.toLowerCase())
            .single()

        // Return whether the user exists (don't reveal too much info)
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

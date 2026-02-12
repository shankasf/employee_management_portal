import { createServiceClient, createUntypedServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
    try {
        const { token, email, password } = await request.json()

        if (!token || !email || !password) {
            return NextResponse.json({ error: 'Token, email, and password are required' }, { status: 400 })
        }

        if (password.length < 8) {
            return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
        }

        const supabase = await createServiceClient()
        const untypedSupabase = await createUntypedServiceClient()
        const normalizedEmail = email.toLowerCase().trim()

        // Hash the provided token to compare with stored hash
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

        // Find user with matching token
        // Note: These columns must be added via migration 003_password_reset_tokens.sql
        const { data: profile, error: profileError } = await untypedSupabase
            .from('profiles')
            .select('id, reset_token_hash, reset_token_expires')
            .eq('email', normalizedEmail)
            .single()

        if (profileError || !profile) {
            console.log('[ResetPassword] User not found:', normalizedEmail)
            return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })
        }

        // Verify token hash matches (timing-safe comparison)
        if (!profile.reset_token_hash ||
            !crypto.timingSafeEqual(
                Buffer.from(profile.reset_token_hash, 'hex'),
                Buffer.from(tokenHash, 'hex')
            )) {
            console.log('[ResetPassword] Token hash mismatch')
            return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })
        }

        // Check if token has expired
        if (!profile.reset_token_expires || new Date(profile.reset_token_expires) < new Date()) {
            console.log('[ResetPassword] Token expired')
            return NextResponse.json({ error: 'Reset link has expired. Please request a new one.' }, { status: 400 })
        }

        // Update password using Supabase Admin API
        const { error: updateError } = await supabase.auth.admin.updateUserById(
            profile.id,
            { password }
        )

        if (updateError) {
            console.error('[ResetPassword] Failed to update password:', updateError)
            return NextResponse.json({ error: 'Failed to update password' }, { status: 500 })
        }

        // Clear the reset token
        await untypedSupabase
            .from('profiles')
            .update({
                reset_token_hash: null,
                reset_token_expires: null,
            })
            .eq('id', profile.id)

        console.log('[ResetPassword] Password reset successful for:', normalizedEmail)
        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('[ResetPassword] Unexpected error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

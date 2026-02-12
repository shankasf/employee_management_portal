import { createServiceClient, createUntypedServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendPasswordResetEmail } from '@/lib/email'
import { sendPasswordResetSMS } from '@/lib/sms'
import crypto from 'crypto'

interface ProfileData {
    id: string
    email: string
    full_name: string | null
}

export async function POST(request: NextRequest) {
    try {
        const { email } = await request.json()

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 })
        }

        const supabase = await createServiceClient()
        const untypedSupabase = await createUntypedServiceClient()
        const normalizedEmail = email.toLowerCase().trim()

        // Check if user exists in profiles table
        const { data, error: profileError } = await supabase
            .from('profiles')
            .select('id, email, full_name')
            .eq('email', normalizedEmail)
            .single()

        const profile = data as ProfileData | null

        if (profileError || !profile) {
            // Don't reveal if user exists or not for security
            // But still return success to prevent email enumeration
            console.log('[ForgotPassword] User not found:', normalizedEmail)
            return NextResponse.json({ success: true })
        }

        // Generate secure reset token
        const resetToken = crypto.randomBytes(32).toString('hex')
        const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex')
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now

        // Store token in database (using profiles table)
        // Note: These columns must be added via migration 003_password_reset_tokens.sql
        const { error: updateError } = await untypedSupabase
            .from('profiles')
            .update({
                reset_token_hash: tokenHash,
                reset_token_expires: expiresAt.toISOString(),
            })
            .eq('id', profile.id)

        if (updateError) {
            console.error('[ForgotPassword] Failed to store reset token:', updateError)
            return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
        }

        // Build reset URL
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://admin.playfunia.com'
        const resetUrl = `${baseUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(normalizedEmail)}`

        // Send email via AWS SES
        const emailResult = await sendPasswordResetEmail({
            email: normalizedEmail,
            name: profile.full_name || 'User',
            resetUrl,
        })

        if (!emailResult.success) {
            console.error('[ForgotPassword] Failed to send email:', emailResult.error)
            return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
        }

        // Try to send SMS if user has a phone number
        const { data: employeeData } = await supabase
            .from('employees')
            .select('phone_number')
            .eq('id', profile.id)
            .single()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const empPhone = (employeeData as any)?.phone_number
        if (empPhone) {
            sendPasswordResetSMS({
                name: profile.full_name || 'User',
                phone: empPhone,
                resetUrl,
            }).catch(err => console.error('[ForgotPassword] Failed to send SMS:', err))
        }

        console.log('[ForgotPassword] Reset email sent to:', normalizedEmail)
        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('[ForgotPassword] Unexpected error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

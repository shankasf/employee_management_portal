import { NextResponse } from 'next/server'
import { createClient, createUntypedServiceClient } from '@/lib/supabase/server'

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])

export async function POST(request: Request) {
    try {
        // Authenticate user
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { storagePath } = body

        if (!storagePath || typeof storagePath !== 'string') {
            return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
        }

        // Ownership enforcement: path must start with profile_{userId}_
        const expectedPrefix = `profile_${user.id}_`
        if (!storagePath.startsWith(expectedPrefix)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        // Validate file extension is an image type
        const ext = storagePath.split('.').pop()?.toLowerCase()
        if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
            return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
        }

        // Use untyped service client (avoids TS inference issues with typed client)
        const serviceClient = await createUntypedServiceClient()

        // Get current profile picture for cleanup
        const { data: currentEmployee } = await serviceClient
            .from('employees')
            .select('profile_picture_url')
            .eq('id', user.id)
            .single()

        const oldPicturePath = currentEmployee?.profile_picture_url

        // Update employee profile picture URL
        const { error: updateError } = await serviceClient
            .from('employees')
            .update({ profile_picture_url: storagePath })
            .eq('id', user.id)

        if (updateError) {
            console.error('Error updating profile picture:', updateError)
            return NextResponse.json({ error: 'Failed to update profile picture' }, { status: 500 })
        }

        // Best-effort cleanup of old picture from storage
        if (oldPicturePath && oldPicturePath !== storagePath && !oldPicturePath.startsWith('http')) {
            serviceClient.storage
                .from('profile-pictures')
                .remove([oldPicturePath])
                .catch((err: unknown) => {
                    console.warn('Failed to cleanup old profile picture:', oldPicturePath, err)
                })
        }

        return NextResponse.json({ success: true })
    } catch {
        return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
    }
}

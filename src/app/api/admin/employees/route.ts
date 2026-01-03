import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Create admin client with service role key
function createAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
}

export async function POST(request: NextRequest) {
    try {
        // Verify the user is an admin
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        if ((profile as { role: string } | null)?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
        }

        // Get form data
        const body = await request.json()
        const {
            email,
            password,
            full_name,
            display_name,
            position,
            shift_type,
            role,
            // New fields
            shift_start,
            shift_end,
            company_name,
            work_location,
            date_of_birth,
            phone_number,
            street_address,
            city,
            state,
            zip_code,
            country,
            id_document_type,
            id_document_number,
            id_document_expiry,
            emergency_contact_name,
            emergency_contact_phone,
            hr_notes,
        } = body

        if (!email || !password || !full_name) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Use admin client to create user
        const adminClient = createAdminClient()

        // Create user in auth.users
        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Auto-confirm email
            user_metadata: {
                full_name,
                role: role || 'employee'
            }
        })

        if (authError) {
            console.error('Auth error:', authError)
            return NextResponse.json({ error: authError.message }, { status: 400 })
        }

        if (!authData.user) {
            return NextResponse.json({ error: 'User not created' }, { status: 500 })
        }

        const userId = authData.user.id

        // Wait for trigger to complete
        await new Promise(resolve => setTimeout(resolve, 300))

        // Update profile with full details
        const { error: profileError } = await adminClient
            .from('profiles')
            .upsert({
                id: userId,
                email,
                full_name,
                role: role || 'employee',
                status: 'active'
            }, { onConflict: 'id' })

        if (profileError) {
            console.error('Profile error:', profileError)
            // Don't fail - trigger might have created it
        }

        // Update employee with full details
        const { error: empError } = await adminClient
            .from('employees')
            .upsert({
                id: userId,
                display_name: display_name || full_name,
                position: position || null,
                shift_type: shift_type || 'full-time',
                // New fields
                shift_start: shift_start || null,
                shift_end: shift_end || null,
                company_name: company_name || null,
                work_location: work_location || null,
                date_of_birth: date_of_birth || null,
                phone_number: phone_number || null,
                street_address: street_address || null,
                city: city || null,
                state: state || null,
                zip_code: zip_code || null,
                country: country || 'USA',
                id_document_type: id_document_type || null,
                id_document_number: id_document_number || null,
                id_document_expiry: id_document_expiry || null,
                emergency_contact_name: emergency_contact_name || null,
                emergency_contact_phone: emergency_contact_phone || null,
                hr_notes: hr_notes || null,
                is_active: true
            }, { onConflict: 'id' })

        if (empError) {
            console.error('Employee error:', empError)
            // Don't fail - trigger might have created it
        }

        return NextResponse.json({
            success: true,
            user: { id: userId, email }
        })

    } catch (error) {
        console.error('Error creating employee:', error)
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest) {
    try {
        // Verify the user is an admin
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        if ((profile as { role: string } | null)?.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const employeeId = searchParams.get('id')

        if (!employeeId) {
            return NextResponse.json({ error: 'Employee ID required' }, { status: 400 })
        }

        const adminClient = createAdminClient()

        // Delete from employees table first (cascade will handle related records)
        const { error: empError } = await adminClient
            .from('employees')
            .delete()
            .eq('id', employeeId)

        if (empError) {
            console.error('Employee delete error:', empError)
        }

        // Delete from profiles table
        const { error: profileError } = await adminClient
            .from('profiles')
            .delete()
            .eq('id', employeeId)

        if (profileError) {
            console.error('Profile delete error:', profileError)
        }

        // Delete from Supabase Auth
        const { error: authError } = await adminClient.auth.admin.deleteUser(employeeId)

        if (authError) {
            console.error('Auth delete error:', authError)
            return NextResponse.json({ error: authError.message }, { status: 400 })
        }

        return NextResponse.json({
            success: true,
            message: 'Employee permanently deleted'
        })

    } catch (error) {
        console.error('Error deleting employee:', error)
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
    }
}

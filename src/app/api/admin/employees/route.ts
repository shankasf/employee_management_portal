import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendWelcomeEmail, sendEmployeeCreatedNotification, sendEmployeeDeletedNotification } from '@/lib/email'
import { sendWelcomeSMS, sendEmployeeCreatedSMS, sendEmployeeDeletedSMS } from '@/lib/sms'
import { getCurrentNYTime } from '@/lib/utils'
import { logActivity, getRequestInfo } from '@/lib/activity-log'
import { serverLog } from '@/lib/server-log'

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
    const startTime = Date.now()
    serverLog.api('POST /api/admin/employees - Creating employee')

    try {
        // Verify the user is an admin
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            serverLog.apiError('Unauthorized - no user session')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        serverLog.api('User authenticated', { email: user.email })

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
            serverLog.apiError('Missing required fields', { data: { email: !!email, password: !!password, full_name: !!full_name } })
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        if (password.length < 8) {
            return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
        }

        serverLog.api('Creating employee', { data: { email, full_name, position } })

        // Use admin client to create user
        const adminClient = createAdminClient()

        // Create user in auth.users
        serverLog.db('Creating auth user')
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
            serverLog.dbError('Auth user creation failed', { error: authError })
            return NextResponse.json({ error: 'Failed to create user account' }, { status: 400 })
        }

        if (!authData.user) {
            serverLog.dbError('Auth user not created - no user returned')
            return NextResponse.json({ error: 'User not created' }, { status: 500 })
        }

        const userId = authData.user.id
        serverLog.db('Auth user created', { data: { userId } })

        // IMPORTANT: Create profile FIRST, then employee
        // employees table has FK constraint to profiles, so profile must exist first
        serverLog.db('Creating profile record')
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
            serverLog.dbError('Profile creation failed', { error: profileError })
            // Clean up auth user
            await adminClient.auth.admin.deleteUser(userId)
            return NextResponse.json({
                error: `Failed to create profile: ${profileError.message}`
            }, { status: 500 })
        }

        // Now create employee record (profile exists, FK constraint satisfied)
        serverLog.db('Creating employee record')
        const { error: empError } = await adminClient
            .from('employees')
            .upsert({
                id: userId,
                display_name: display_name || full_name,
                position: position || null,
                shift_type: shift_type || 'full-time',
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
            serverLog.dbError('Employee record creation failed', { error: empError })
            // Clean up auth user and profile
            await adminClient.from('profiles').delete().eq('id', userId)
            await adminClient.auth.admin.deleteUser(userId)
            return NextResponse.json({
                error: `Failed to create employee record: ${empError.message}`
            }, { status: 500 })
        }

        // Verify employee was actually created
        serverLog.db('Verifying employee record')
        const { data: verifyEmp, error: verifyError } = await adminClient
            .from('employees')
            .select('id')
            .eq('id', userId)
            .single()

        if (verifyError || !verifyEmp) {
            serverLog.dbError('Employee verification failed', { error: verifyError })
            // Clean up profile and auth user if employee doesn't exist
            await adminClient.from('profiles').delete().eq('id', userId)
            await adminClient.auth.admin.deleteUser(userId)
            return NextResponse.json({
                error: 'Employee record was not created. Please try again.'
            }, { status: 500 })
        }

        serverLog.db('Employee record verified successfully')

        // Log the activity (non-blocking)
        const { ipAddress, userAgent } = getRequestInfo(request.headers)
        logActivity({
            adminId: user.id,
            adminEmail: user.email || 'unknown',
            action: 'employee_created',
            entityType: 'employee',
            entityId: userId,
            entityName: display_name || full_name,
            details: {
                email,
                position: position || null,
                role: role || 'employee',
            },
            ipAddress,
            userAgent,
        }).catch(err => console.error('Failed to log activity:', err))

        // Send welcome email with credentials (non-blocking)
        sendWelcomeEmail({
            employeeName: display_name || full_name,
            email,
            tempPassword: password,
        }).catch(err => console.error('Failed to send welcome email:', err))

        // Send welcome SMS if phone number provided (non-blocking)
        if (phone_number) {
            sendWelcomeSMS({
                employeeName: display_name || full_name,
                phone: phone_number,
                tempPassword: password,
            }).catch(err => console.error('Failed to send welcome SMS:', err))
        }

        // Send notification to admin about new employee (non-blocking)
        sendEmployeeCreatedNotification({
            employeeName: display_name || full_name,
            email,
            position: position || undefined,
            createdAt: getCurrentNYTime(),
        }).catch(err => console.error('Failed to send admin notification:', err))

        // Send SMS notification to admins about new employee (non-blocking)
        sendEmployeeCreatedSMS({
            employeeName: display_name || full_name,
            email,
            position: position || undefined,
        }).catch(err => console.error('Failed to send admin SMS notification:', err))

        const duration = Date.now() - startTime
        serverLog.api('Employee created successfully', { email, duration, data: { userId } })

        return NextResponse.json({
            success: true,
            user: { id: userId, email }
        })

    } catch (error) {
        const duration = Date.now() - startTime
        serverLog.apiError('Error creating employee', { error, duration })
        return NextResponse.json({
            error: 'Internal server error'
        }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest) {
    const startTime = Date.now()
    serverLog.api('DELETE /api/admin/employees - Deleting employee')

    try {
        // Verify the user is an admin
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            serverLog.apiError('Unauthorized - no user session')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        if ((profile as { role: string } | null)?.role !== 'admin') {
            serverLog.apiError('Forbidden - not admin', { email: user.email })
            return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const employeeId = searchParams.get('id')

        if (!employeeId) {
            serverLog.apiError('Employee ID missing')
            return NextResponse.json({ error: 'Employee ID required' }, { status: 400 })
        }

        serverLog.api('Deleting employee', { data: { employeeId }, email: user.email })
        const adminClient = createAdminClient()

        // Fetch employee data BEFORE deletion (for email/SMS notification)
        const { data: employeeData } = await adminClient
            .from('employees')
            .select(`
                display_name,
                position,
                phone_number,
                profiles (
                    email,
                    full_name
                )
            `)
            .eq('id', employeeId)
            .single()

        // Store employee info for notification
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const empInfo = employeeData as any
        const employeeName = empInfo?.display_name || empInfo?.profiles?.full_name || 'Unknown'
        const employeeEmail = empInfo?.profiles?.email || null
        const employeePhone = empInfo?.phone_number || null
        const employeePosition = empInfo?.position || undefined

        // Delete sequentially: employees first (FK dependency), then profiles, then auth
        const { error: empDeleteError } = await adminClient.from('employees').delete().eq('id', employeeId)
        if (empDeleteError) {
            console.error('Employee delete error:', empDeleteError)
            return NextResponse.json({ error: 'Failed to delete employee record' }, { status: 500 })
        }

        const { error: profileDeleteError } = await adminClient.from('profiles').delete().eq('id', employeeId)
        if (profileDeleteError) {
            console.error('Profile delete error:', profileDeleteError)
            return NextResponse.json({ error: 'Failed to delete profile record' }, { status: 500 })
        }

        const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(employeeId)
        if (authDeleteError) {
            console.error('Auth delete error:', authDeleteError)
            return NextResponse.json({ error: 'Failed to delete auth user' }, { status: 500 })
        }

        // Log the activity (non-blocking)
        const { ipAddress, userAgent } = getRequestInfo(request.headers)
        logActivity({
            adminId: user.id,
            adminEmail: user.email || 'unknown',
            action: 'employee_deleted',
            entityType: 'employee',
            entityId: employeeId,
            entityName: employeeName,
            details: {
                email: employeeEmail,
                position: employeePosition,
            },
            ipAddress,
            userAgent,
        }).catch(err => console.error('Failed to log activity:', err))

        // Send email notifications (non-blocking)
        if (employeeEmail) {
            sendEmployeeDeletedNotification({
                employeeName,
                email: employeeEmail,
                position: employeePosition,
                deletedAt: getCurrentNYTime(),
            }).catch(err => console.error('Failed to send deletion notification:', err))
        }

        // Send SMS notifications (non-blocking)
        sendEmployeeDeletedSMS({
            employeeName,
            email: employeeEmail || 'unknown',
            phone: employeePhone || undefined,
        }).catch(err => console.error('Failed to send deletion SMS:', err))

        const duration = Date.now() - startTime
        serverLog.api('Employee deleted successfully', { data: { employeeId, employeeName }, duration })

        return NextResponse.json({
            success: true,
            message: 'Employee permanently deleted'
        })

    } catch (error) {
        const duration = Date.now() - startTime
        serverLog.apiError('Error deleting employee', { error, duration })
        return NextResponse.json({
            error: 'Internal server error'
        }, { status: 500 })
    }
}

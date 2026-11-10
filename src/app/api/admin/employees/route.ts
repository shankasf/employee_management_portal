import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendWelcomeEmail, sendEmployeeCreatedNotification, sendEmployeeDeletedNotification } from '@/lib/email'
import { getCurrentNYTime } from '@/lib/utils'
import { logActivity, getRequestInfo } from '@/lib/activity-log'
import { serverLog } from '@/lib/server-log'
import { getAdminContext, isEmployeeInScope } from '@/lib/auth/adminScope'

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

        const ctx = await getAdminContext()
        if (!ctx || ctx.role !== 'admin') {
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
            role: rawRole,
            // Admin-scope fields (super-admin only)
            admin_scoped: rawAdminScoped,
            admin_business_ids: rawAdminBusinessIds,
            // New fields
            shift_start,
            shift_end,
            business_ids: rawBusinessIds,
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

        // --- Privilege + scope enforcement on the CALLER ---
        // Scoped admins can never create another admin, and may only assign
        // employees to their own managed locations.
        let role = rawRole
        let business_ids = rawBusinessIds
        if (ctx.isScoped) {
            role = 'employee'
            const managed = new Set(ctx.managedBusinessIds)
            business_ids = Array.isArray(rawBusinessIds)
                ? rawBusinessIds.filter((b: number) => managed.has(b))
                : []
        }

        // Only super admins may create a scoped admin (admin_scoped + managed locations).
        const makeScopedAdmin =
            role === 'admin' && ctx.isSuperAdmin && rawAdminScoped === true
        const adminBusinessIds: number[] = makeScopedAdmin && Array.isArray(rawAdminBusinessIds)
            ? rawAdminBusinessIds.filter((b: unknown) => typeof b === 'number')
            : []

        // Normalize email to lowercase to match Supabase auth behavior
        const normalizedEmail = email?.toLowerCase().trim()

        if (!normalizedEmail || !password || !full_name) {
            serverLog.apiError('Missing required fields', { data: { email: !!email, password: !!password, full_name: !!full_name } })
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        if (password.length < 8) {
            return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
        }

        serverLog.api('Creating employee', { data: { email: normalizedEmail, full_name, position } })

        // Use admin client to create user
        const adminClient = createAdminClient()

        // Create user in auth.users
        serverLog.db('Creating auth user')
        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
            email: normalizedEmail,
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
                email: normalizedEmail,
                full_name,
                role: role || 'employee',
                status: 'active',
                admin_scoped: makeScopedAdmin,
            }, { onConflict: 'id' })

        if (profileError) {
            serverLog.dbError('Profile creation failed', { error: profileError })
            console.error('Profile creation failed:', profileError.message)
            // Clean up auth user
            await adminClient.auth.admin.deleteUser(userId)
            return NextResponse.json({
                error: 'Failed to create employee'
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
            console.error('Employee record creation failed:', empError.message)
            // Clean up auth user and profile
            await adminClient.from('profiles').delete().eq('id', userId)
            await adminClient.auth.admin.deleteUser(userId)
            return NextResponse.json({
                error: 'Failed to create employee'
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

        // Insert business assignments
        if (Array.isArray(business_ids) && business_ids.length > 0) {
            const { error: bizError } = await adminClient.from('employee_businesses').insert(
                business_ids.map((bid: number) => ({ employee_id: userId, business_id: bid }))
            )
            if (bizError) {
                serverLog.dbError('Business assignment failed', { error: bizError })
                // Non-fatal: employee was created, just log the error
                console.error('Business assignment failed:', bizError.message)
            }
        }

        // Insert managed-location assignments for a newly created scoped admin.
        if (makeScopedAdmin && adminBusinessIds.length > 0) {
            const { error: adminBizError } = await adminClient.from('admin_businesses').insert(
                adminBusinessIds.map((bid: number) => ({ admin_id: userId, business_id: bid }))
            )
            if (adminBizError) {
                serverLog.dbError('Admin location assignment failed', { error: adminBizError })
                console.error('Admin location assignment failed:', adminBizError.message)
            }
        }

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
                email: normalizedEmail,
                position: position || null,
                role: role || 'employee',
            },
            ipAddress,
            userAgent,
        }).catch(err => console.error('Failed to log activity:', err))

        // Send welcome email with credentials (non-blocking)
        sendWelcomeEmail({
            employeeName: display_name || full_name,
            email: normalizedEmail,
            tempPassword: password,
        }).catch(err => console.error('Failed to send welcome email:', err))

        // Send notification to admin about new employee (non-blocking)
        sendEmployeeCreatedNotification({
            employeeName: display_name || full_name,
            email: normalizedEmail,
            position: position || undefined,
            createdAt: getCurrentNYTime(),
        }).catch(err => console.error('Failed to send admin notification:', err))

        const duration = Date.now() - startTime
        serverLog.api('Employee created successfully', { email: normalizedEmail, duration, data: { userId } })

        return NextResponse.json({
            success: true,
            user: { id: userId, email: normalizedEmail }
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

        const ctx = await getAdminContext()
        if (!ctx || ctx.role !== 'admin') {
            serverLog.apiError('Forbidden - not admin', { email: user.email })
            return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
        }

        // Deleting an employee is a company-wide action (they may belong to
        // multiple locations); restrict it to full admins.
        if (ctx.isScoped) {
            return NextResponse.json({ error: 'Forbidden - deleting employees requires full admin access' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const employeeId = searchParams.get('id')

        if (!employeeId) {
            serverLog.apiError('Employee ID missing')
            return NextResponse.json({ error: 'Employee ID required' }, { status: 400 })
        }

        serverLog.api('Deleting employee', { data: { employeeId }, email: user.email })
        const adminClient = createAdminClient()

        // Fetch employee data BEFORE deletion (for email notification)
        const { data: employeeData } = await adminClient
            .from('employees')
            .select(`
                display_name,
                position,
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
        const employeePosition = empInfo?.position || undefined

        // Delete all related records first (FK dependencies), then employees, profiles, auth

        // Step 1: Delete from all dependent tables that reference this employee
        const dependentDeletes = [
            adminClient.from('employee_businesses').delete().eq('employee_id', employeeId),
            adminClient.from('attendance_logs').delete().eq('employee_id', employeeId),
            adminClient.from('task_instances').delete().eq('employee_id', employeeId),
            adminClient.from('event_staff_assignments').delete().eq('employee_id', employeeId),
            adminClient.from('transactions').delete().eq('handled_by_employee', employeeId),
            adminClient.from('staff_notes').delete().eq('employee_id', employeeId),
        ]
        const dependentResults = await Promise.all(dependentDeletes)
        for (const { error } of dependentResults) {
            if (error) {
                console.error('Dependent record delete error:', error)
                return NextResponse.json({ error: 'Failed to delete related employee records' }, { status: 500 })
            }
        }

        // Step 2: Delete schedule_email_logs (FK to schedules), then schedules
        // First get schedule IDs for this employee
        const { data: scheduleIds } = await adminClient
            .from('schedules')
            .select('id')
            .eq('employee_id', employeeId)
        if (scheduleIds && scheduleIds.length > 0) {
            const ids = scheduleIds.map(s => s.id)
            const { error: emailLogError } = await adminClient
                .from('schedule_email_logs')
                .delete()
                .in('schedule_id', ids)
            if (emailLogError) {
                console.error('Schedule email log delete error:', emailLogError)
                return NextResponse.json({ error: 'Failed to delete schedule email logs' }, { status: 500 })
            }
        }
        const { error: scheduleDeleteError } = await adminClient.from('schedules').delete().eq('employee_id', employeeId)
        if (scheduleDeleteError) {
            console.error('Schedule delete error:', scheduleDeleteError)
            return NextResponse.json({ error: 'Failed to delete schedule records' }, { status: 500 })
        }

        // Step 3: Delete employee record
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

/**
 * PATCH /api/admin/employees — sync an employee's location (business) tags.
 * Body: { id: string, business_ids: number[] }
 *
 * Runs with the service role and DIFFS the assignments (insert missing,
 * delete removed) instead of delete-all-then-insert. The old client-side
 * delete+insert broke for scoped (location) admins: once the rows were
 * deleted, the RLS insert check (which requires the employee to already be
 * tagged to one of the admin's locations) failed, leaving the employee with
 * no locations and invisible to that admin.
 *
 * Scoped admins may only add/remove tags within their managed locations;
 * tags for other locations are left untouched.
 */
export async function PATCH(request: NextRequest) {
    const startTime = Date.now()
    try {
        const ctx = await getAdminContext()
        if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        if (ctx.role !== 'admin') return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })

        const body = await request.json()
        const employeeId: unknown = body?.id
        const rawIds: unknown = body?.business_ids
        if (typeof employeeId !== 'string' || !employeeId) {
            return NextResponse.json({ error: 'Employee ID required' }, { status: 400 })
        }
        if (!Array.isArray(rawIds)) {
            return NextResponse.json({ error: 'business_ids must be an array' }, { status: 400 })
        }
        const requested = Array.from(new Set(rawIds.filter((b): b is number => Number.isInteger(b))))

        if (ctx.isScoped && !(await isEmployeeInScope(ctx, employeeId))) {
            return NextResponse.json({ error: 'Forbidden - employee is not in your locations' }, { status: 403 })
        }

        const adminClient = createAdminClient()
        const { data: currentRows, error: readError } = await adminClient
            .from('employee_businesses')
            .select('business_id')
            .eq('employee_id', employeeId)
        if (readError) {
            serverLog.dbError('Failed to read business assignments', { error: readError })
            return NextResponse.json({ error: 'Failed to read location assignments' }, { status: 500 })
        }
        const current = new Set((currentRows || []).map(r => r.business_id as number))

        // Scoped admins can only touch their managed locations.
        const editable = ctx.isScoped ? new Set(ctx.managedBusinessIds) : null
        const canEdit = (b: number) => !editable || editable.has(b)

        const toInsert = requested.filter(b => !current.has(b) && canEdit(b))
        const toDelete = Array.from(current).filter(b => !requested.includes(b) && canEdit(b))

        // Insert first, then delete, so the employee never transiently has zero tags.
        if (toInsert.length > 0) {
            const { error } = await adminClient
                .from('employee_businesses')
                .insert(toInsert.map(bid => ({ employee_id: employeeId, business_id: bid })))
            if (error) {
                serverLog.dbError('Failed to add business assignments', { error })
                return NextResponse.json({ error: 'Failed to add location assignments' }, { status: 500 })
            }
        }
        if (toDelete.length > 0) {
            const { error } = await adminClient
                .from('employee_businesses')
                .delete()
                .eq('employee_id', employeeId)
                .in('business_id', toDelete)
            if (error) {
                serverLog.dbError('Failed to remove business assignments', { error })
                return NextResponse.json({ error: 'Failed to remove location assignments' }, { status: 500 })
            }
        }

        serverLog.api('Employee locations synced', {
            duration: Date.now() - startTime,
            data: { employeeId, added: toInsert, removed: toDelete },
        })
        return NextResponse.json({ success: true, added: toInsert, removed: toDelete })
    } catch (error) {
        serverLog.apiError('Error syncing employee locations', { error, duration: Date.now() - startTime })
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

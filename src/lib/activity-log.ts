import { createClient } from '@supabase/supabase-js'

// Activity log types
export type ActivityAction =
    | 'employee_created'
    | 'employee_deleted'
    | 'employee_deactivated'
    | 'employee_reactivated'
    | 'employee_updated'
    | 'device_cleared'
    | 'password_reset_requested'
    | 'password_reset_completed'
    | 'schedule_created'
    | 'schedule_deleted'
    | 'task_created'
    | 'task_updated'
    | 'task_deleted'
    | 'task_assigned'
    | 'task_bulk_assigned'
    | 'task_bulk_deleted'
    | 'task_instance_status_updated'
    | 'task_instance_deleted'
    | 'task_instances_bulk_deleted'
    | 'task_media_auto_deleted'
    | 'recurring_tasks_created'
    | 'task_deadline_reminder_sent'
    | 'task_completed'
    | 'task_submission_updated'
    | 'tasks_loaded'
    | 'tasks_load_failed'
    | 'event_created'
    | 'event_deleted'
    | 'policy_created'
    | 'policy_deleted'
    | 'attendance_time_edited'
    | 'clock_in_reminder_sent'
    | 'clock_out_reminder_sent'
    | 'onboarding_content_created'
    | 'onboarding_content_updated'
    | 'onboarding_content_deleted'
    | 'onboarding_item_completed'
    | 'onboarding_completed'
    | 'onboarding_completion_acknowledged'
    | 'onboarding_completions_bulk_acknowledged'
    | 'onboarding_completion_email_sent'
    | 'onboarding_completion_email_failed'

export type EntityType =
    | 'employee'
    | 'schedule'
    | 'task'
    | 'task_instance'
    | 'event'
    | 'policy'
    | 'attendance'
    | 'onboarding_content'
    | 'onboarding_completion'

export interface ActivityLogEntry {
    adminId: string | null
    adminEmail: string
    action: ActivityAction
    entityType: EntityType
    entityId?: string
    entityName?: string
    details?: Record<string, unknown>
    ipAddress?: string
    userAgent?: string
}

// Create admin client for logging (uses service role)
function getAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
}

/**
 * Log an admin activity to the database
 * This function is fire-and-forget - errors are logged but don't block the main operation
 */
export async function logActivity(entry: ActivityLogEntry): Promise<void> {
    try {
        const adminClient = getAdminClient()

        const { error } = await adminClient.from('activity_logs').insert({
            admin_id: entry.adminId || null,
            admin_email: entry.adminEmail,
            action: entry.action,
            entity_type: entry.entityType,
            entity_id: entry.entityId || null,
            entity_name: entry.entityName || null,
            details: entry.details || null,
            ip_address: entry.ipAddress || null,
            user_agent: entry.userAgent || null,
        })
        if (error) {
            console.error('[ActivityLog] Insert error:', error.message)
        }
    } catch (error) {
        // Log to console but don't throw - activity logging should not block operations
        console.error('[ActivityLog] Failed to log activity:', error)
    }
}

/**
 * Helper to extract IP and User Agent from request headers
 */
export function getRequestInfo(headers: Headers): { ipAddress?: string; userAgent?: string } {
    const ipAddress = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        headers.get('x-real-ip') ||
        undefined

    const userAgent = headers.get('user-agent') || undefined

    return { ipAddress, userAgent }
}

/**
 * Format action for display
 */
export function formatAction(action: ActivityAction): string {
    const actionLabels: Record<ActivityAction, string> = {
        employee_created: 'Created employee',
        employee_deleted: 'Deleted employee',
        employee_deactivated: 'Deactivated employee',
        employee_reactivated: 'Reactivated employee',
        employee_updated: 'Updated employee',
        device_cleared: 'Cleared device registration',
        password_reset_requested: 'Requested password reset',
        password_reset_completed: 'Completed password reset',
        schedule_created: 'Created schedule',
        schedule_deleted: 'Deleted schedule',
        task_created: 'Created task',
        task_updated: 'Updated task',
        task_deleted: 'Deleted task',
        task_assigned: 'Assigned task',
        task_bulk_assigned: 'Bulk assigned tasks',
        task_bulk_deleted: 'Bulk deleted tasks',
        task_instance_status_updated: 'Changed task status',
        task_instance_deleted: 'Deleted task instance',
        task_instances_bulk_deleted: 'Bulk deleted task instances',
        task_media_auto_deleted: 'Auto-deleted task media (72h)',
        recurring_tasks_created: 'Created recurring task instances',
        task_deadline_reminder_sent: 'Sent task deadline reminder',
        task_completed: 'Completed task',
        task_submission_updated: 'Updated task submission',
        tasks_loaded: 'Loaded tasks',
        tasks_load_failed: 'Failed to load tasks',
        event_created: 'Created event',
        event_deleted: 'Deleted event',
        policy_created: 'Created policy',
        policy_deleted: 'Deleted policy',
        attendance_time_edited: 'Edited attendance time',
        clock_in_reminder_sent: 'Sent clock-in reminder',
        clock_out_reminder_sent: 'Sent clock-out reminder',
        onboarding_content_created: 'Created onboarding content',
        onboarding_content_updated: 'Updated onboarding content',
        onboarding_content_deleted: 'Deleted onboarding content',
        onboarding_item_completed: 'Completed onboarding item',
        onboarding_completed: 'Completed onboarding',
        onboarding_completion_acknowledged: 'Acknowledged onboarding completion',
        onboarding_completions_bulk_acknowledged: 'Bulk acknowledged onboarding completions',
        onboarding_completion_email_sent: 'Sent onboarding completion email',
        onboarding_completion_email_failed: 'Onboarding completion email failed',
    }
    return actionLabels[action] || action
}

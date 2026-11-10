'use client'

import { useEffect } from 'react'
import useSWR from 'swr'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import ClockInOutCard from '@/components/ClockInOutCard'
import { useOpenAttendance, useTodayTasks } from '@/lib/hooks/useData'
import { logPageView } from '@/lib/usage-log'

interface Task {
    id: string
    title: string
    status: string
}

export default function AdminClockPage() {
    const { user, employee } = useAuth()

    useEffect(() => {
        logPageView('Admin: Clock In/Out', 'attendance')
    }, [])

    const { data: openAttendance, mutate: mutateAttendance } = useOpenAttendance(user?.id)
    const { data: todayTasks } = useTodayTasks(user?.id)

    const { data: deviceData } = useSWR(
        user?.id ? ['admin:device', user.id] : null,
        async () => {
            const supabase = createUntypedClient()
            const { data } = await supabase
                .from('employees')
                .select('registered_device_id, device_name')
                .eq('id', user!.id)
                .single()
            return data as { registered_device_id: string | null; device_name: string | null } | null
        },
        { revalidateOnFocus: false, dedupingInterval: 60000 }
    )

    const clockedIn = openAttendance as { id: string; clock_in: string } | null
    const pendingTasks = ((todayTasks || []) as Task[])
        .filter((t) => t.status === 'pending')
        .map((t) => ({ id: t.id, title: t.title }))

    return (
        <div className="space-y-4 sm:space-y-6">
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold">Clock In / Out</h1>
                <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                    {employee?.display_name ? `${employee.display_name} — ` : ''}
                    {new Date().toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        timeZone: 'America/New_York',
                    })}
                </p>
            </div>

            <ClockInOutCard
                clockedIn={clockedIn}
                pendingTasks={pendingTasks}
                deviceData={deviceData || null}
                onChange={() => mutateAttendance()}
            />
        </div>
    )
}

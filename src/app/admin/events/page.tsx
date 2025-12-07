'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, formatTime } from '@/lib/utils'

interface Event {
    id: string
    title: string
    start_time: string
    end_time: string
    room: string | null
    expected_headcount: number | null
    notes: string | null
    event_staff_assignments: {
        id: string
        role: string | null
        employees: {
            id: string
            display_name: string | null
        } | null
    }[]
}

export default function EventsPage() {
    const [events, setEvents] = useState<Event[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<'upcoming' | 'today' | 'past'>('upcoming')

    useEffect(() => {
        loadEvents()
    }, [filter])

    async function loadEvents() {
        setLoading(true)
        try {
            const supabase = createClient()
            const now = new Date()
            const todayStart = new Date(now.setHours(0, 0, 0, 0))
            const todayEnd = new Date(now.setHours(23, 59, 59, 999))

            let query = supabase
                .from('events')
                .select(`
          *,
          event_staff_assignments (
            id,
            role,
            employees (
              id,
              display_name
            )
          )
        `)
                .order('start_time', { ascending: filter !== 'past' })

            if (filter === 'upcoming') {
                query = query.gte('start_time', new Date().toISOString())
            } else if (filter === 'today') {
                query = query
                    .gte('start_time', todayStart.toISOString())
                    .lte('start_time', todayEnd.toISOString())
            } else {
                query = query.lt('start_time', new Date().toISOString())
            }

            const { data, error } = await query.limit(50)
            if (error) throw error
            setEvents(data || [])
        } catch (err) {
            console.error('Error loading events:', err)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Events</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage parties and events
                    </p>
                </div>
                <button className="btn-primary">
                    + Create Event
                </button>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 border-b">
                {(['upcoming', 'today', 'past'] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setFilter(tab)}
                        className={`px-4 py-2 font-medium transition-colors border-b-2 -mb-px ${filter === tab
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-32 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : events.length === 0 ? (
                <div className="card p-8 text-center">
                    <p className="text-muted-foreground mb-4">
                        No {filter === 'upcoming' ? 'upcoming' : filter === 'today' ? "today's" : 'past'} events found
                    </p>
                    <button className="btn-primary">Create Event</button>
                </div>
            ) : (
                <div className="space-y-4">
                    {events.map((event) => (
                        <div key={event.id} className="card hover:shadow-md transition-shadow">
                            <div className="p-4">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <span className="text-2xl">🎉</span>
                                            <h3 className="text-xl font-semibold">{event.title}</h3>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-sm text-muted-foreground">
                                            <div className="flex items-center gap-2">
                                                <span>📅</span>
                                                {formatDate(event.start_time)}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span>⏰</span>
                                                {formatTime(event.start_time)} - {formatTime(event.end_time)}
                                            </div>
                                            {event.room && (
                                                <div className="flex items-center gap-2">
                                                    <span>📍</span>
                                                    {event.room}
                                                </div>
                                            )}
                                            {event.expected_headcount && (
                                                <div className="flex items-center gap-2">
                                                    <span>👥</span>
                                                    {event.expected_headcount} guests
                                                </div>
                                            )}
                                        </div>
                                        {event.notes && (
                                            <p className="text-sm text-muted-foreground mt-2 line-clamp-1">
                                                💬 {event.notes}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex flex-wrap gap-1">
                                            {event.event_staff_assignments.length > 0 ? (
                                                event.event_staff_assignments.slice(0, 3).map((assignment) => (
                                                    <span key={assignment.id} className="badge-secondary text-xs">
                                                        {assignment.employees?.display_name || 'Staff'}
                                                        {assignment.role && ` (${assignment.role})`}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="badge-warning text-xs">No staff assigned</span>
                                            )}
                                            {event.event_staff_assignments.length > 3 && (
                                                <span className="badge-outline text-xs">
                                                    +{event.event_staff_assignments.length - 3} more
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <button className="btn-ghost btn-sm">View</button>
                                            <button className="btn-ghost btn-sm">Edit</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

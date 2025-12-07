'use client'

import { useEffect, useState } from 'react'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDate, formatTime } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'

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

interface Employee {
    id: string
    display_name: string | null
    position: string | null
}

export default function EventsPage() {
    const { user } = useAuth()
    const [events, setEvents] = useState<Event[]>([])
    const [employees, setEmployees] = useState<Employee[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<'upcoming' | 'today' | 'past'>('upcoming')
    const [showModal, setShowModal] = useState(false)
    const [showViewModal, setShowViewModal] = useState(false)
    const [showAssignModal, setShowAssignModal] = useState(false)
    const [editingEvent, setEditingEvent] = useState<Event | null>(null)
    const [viewingEvent, setViewingEvent] = useState<Event | null>(null)
    const [assigningEvent, setAssigningEvent] = useState<Event | null>(null)
    const [saving, setSaving] = useState(false)

    // Form state
    const [formData, setFormData] = useState({
        title: '',
        start_time: '',
        end_time: '',
        room: '',
        expected_headcount: '',
        notes: ''
    })

    // Assignment form state
    const [assignData, setAssignData] = useState({
        employee_id: '',
        role: ''
    })

    useEffect(() => {
        loadEvents()
        loadEmployees()
    }, [filter])

    async function loadEvents() {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            const now = new Date()
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
            const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

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

    async function loadEmployees() {
        try {
            const supabase = createUntypedClient()
            const { data, error } = await supabase
                .from('employees')
                .select('id, display_name, position')
                .eq('is_active', true)
                .order('display_name')

            if (error) throw error
            setEmployees(data || [])
        } catch (err) {
            console.error('Error loading employees:', err)
        }
    }

    function openModal(event?: Event) {
        if (event) {
            setEditingEvent(event)
            setFormData({
                title: event.title,
                start_time: event.start_time.slice(0, 16),
                end_time: event.end_time.slice(0, 16),
                room: event.room || '',
                expected_headcount: event.expected_headcount?.toString() || '',
                notes: event.notes || ''
            })
        } else {
            setEditingEvent(null)
            const now = new Date()
            const defaultStart = new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16)
            const defaultEnd = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
            setFormData({
                title: '',
                start_time: defaultStart,
                end_time: defaultEnd,
                room: '',
                expected_headcount: '',
                notes: ''
            })
        }
        setShowModal(true)
    }

    function closeModal() {
        setShowModal(false)
        setEditingEvent(null)
    }

    function openViewModal(event: Event) {
        setViewingEvent(event)
        setShowViewModal(true)
    }

    function closeViewModal() {
        setShowViewModal(false)
        setViewingEvent(null)
    }

    function openAssignModal(event: Event) {
        setAssigningEvent(event)
        setAssignData({ employee_id: '', role: '' })
        setShowAssignModal(true)
    }

    function closeAssignModal() {
        setShowAssignModal(false)
        setAssigningEvent(null)
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        try {
            const supabase = createUntypedClient()

            const eventData = {
                title: formData.title,
                start_time: formData.start_time,
                end_time: formData.end_time,
                room: formData.room || null,
                expected_headcount: formData.expected_headcount ? parseInt(formData.expected_headcount) : null,
                notes: formData.notes || null,
                created_by: user?.id
            }

            if (editingEvent) {
                const { error } = await supabase
                    .from('events')
                    .update(eventData)
                    .eq('id', editingEvent.id)
                if (error) throw error
            } else {
                const { error } = await supabase
                    .from('events')
                    .insert(eventData)
                if (error) throw error
            }

            alert(editingEvent ? 'Event updated!' : 'Event created!')
            closeModal()
            loadEvents()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error saving event:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    async function handleAssign(e: React.FormEvent) {
        e.preventDefault()
        if (!assigningEvent) return
        setSaving(true)
        try {
            const supabase = createUntypedClient()

            const { error } = await supabase
                .from('event_staff_assignments')
                .insert({
                    event_id: assigningEvent.id,
                    employee_id: assignData.employee_id,
                    role: assignData.role || null
                })

            if (error) throw error

            alert('Staff assigned successfully!')
            closeAssignModal()
            loadEvents()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error assigning staff:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    async function removeAssignment(assignmentId: string) {
        if (!confirm('Remove this staff assignment?')) return
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('event_staff_assignments')
                .delete()
                .eq('id', assignmentId)
            if (error) throw error
            loadEvents()
        } catch (err) {
            console.error('Error removing assignment:', err)
        }
    }

    async function deleteEvent(id: string) {
        if (!confirm('Are you sure you want to delete this event?')) return
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('events')
                .delete()
                .eq('id', id)
            if (error) throw error
            loadEvents()
        } catch (err) {
            console.error('Error deleting event:', err)
            alert('Failed to delete event')
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
                <button className="btn-primary" onClick={() => openModal()}>
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
                    <button className="btn-primary" onClick={() => openModal()}>Create Event</button>
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
                                            <button
                                                className="btn-ghost btn-sm"
                                                onClick={() => openViewModal(event)}
                                            >
                                                View
                                            </button>
                                            <button
                                                className="btn-ghost btn-sm"
                                                onClick={() => openModal(event)}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                className="btn-ghost btn-sm"
                                                onClick={() => openAssignModal(event)}
                                            >
                                                Staff
                                            </button>
                                            <button
                                                className="btn-ghost btn-sm text-destructive"
                                                onClick={() => deleteEvent(event.id)}
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create/Edit Event Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <h2 className="text-xl font-bold mb-4">
                                {editingEvent ? 'Edit Event' : 'Create New Event'}
                            </h2>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="label">Title *</label>
                                    <input
                                        type="text"
                                        required
                                        className="input"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="label">Start Time *</label>
                                        <input
                                            type="datetime-local"
                                            required
                                            className="input"
                                            value={formData.start_time}
                                            onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="label">End Time *</label>
                                        <input
                                            type="datetime-local"
                                            required
                                            className="input"
                                            value={formData.end_time}
                                            onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="label">Room</label>
                                        <input
                                            type="text"
                                            className="input"
                                            placeholder="e.g., Party Room A"
                                            value={formData.room}
                                            onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Expected Guests</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={formData.expected_headcount}
                                            onChange={(e) => setFormData({ ...formData, expected_headcount: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="label">Notes</label>
                                    <textarea
                                        className="input min-h-[80px]"
                                        placeholder="e.g., parent can leave, extra socks needed"
                                        value={formData.notes}
                                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                    />
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        className="btn-secondary flex-1"
                                        onClick={closeModal}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn-primary flex-1"
                                        disabled={saving}
                                    >
                                        {saving ? 'Saving...' : editingEvent ? 'Update Event' : 'Create Event'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* View Event Modal */}
            {showViewModal && viewingEvent && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <h2 className="text-xl font-bold mb-4">🎉 {viewingEvent.title}</h2>
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-muted-foreground">Date</p>
                                        <p className="font-medium">{formatDate(viewingEvent.start_time)}</p>
                                    </div>
                                    <div>
                                        <p className="text-muted-foreground">Time</p>
                                        <p className="font-medium">{formatTime(viewingEvent.start_time)} - {formatTime(viewingEvent.end_time)}</p>
                                    </div>
                                    {viewingEvent.room && (
                                        <div>
                                            <p className="text-muted-foreground">Room</p>
                                            <p className="font-medium">{viewingEvent.room}</p>
                                        </div>
                                    )}
                                    {viewingEvent.expected_headcount && (
                                        <div>
                                            <p className="text-muted-foreground">Expected Guests</p>
                                            <p className="font-medium">{viewingEvent.expected_headcount}</p>
                                        </div>
                                    )}
                                </div>
                                {viewingEvent.notes && (
                                    <div>
                                        <p className="text-muted-foreground text-sm">Notes</p>
                                        <p className="text-sm mt-1 p-3 bg-muted rounded">{viewingEvent.notes}</p>
                                    </div>
                                )}
                                <div>
                                    <p className="text-muted-foreground text-sm mb-2">Assigned Staff</p>
                                    {viewingEvent.event_staff_assignments.length > 0 ? (
                                        <div className="space-y-2">
                                            {viewingEvent.event_staff_assignments.map((a) => (
                                                <div key={a.id} className="flex items-center justify-between p-2 bg-muted rounded">
                                                    <span>
                                                        {a.employees?.display_name || 'Staff'}
                                                        {a.role && <span className="text-muted-foreground"> ({a.role})</span>}
                                                    </span>
                                                    <button
                                                        className="btn-ghost btn-sm text-destructive"
                                                        onClick={() => removeAssignment(a.id)}
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">No staff assigned yet</p>
                                    )}
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        className="btn-secondary flex-1"
                                        onClick={closeViewModal}
                                    >
                                        Close
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-primary flex-1"
                                        onClick={() => { closeViewModal(); openAssignModal(viewingEvent); }}
                                    >
                                        + Add Staff
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Assign Staff Modal */}
            {showAssignModal && assigningEvent && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md">
                        <div className="p-6">
                            <h2 className="text-xl font-bold mb-2">Assign Staff</h2>
                            <p className="text-muted-foreground mb-4">{assigningEvent.title}</p>
                            <form onSubmit={handleAssign} className="space-y-4">
                                <div>
                                    <label className="label">Employee *</label>
                                    <select
                                        required
                                        className="input"
                                        value={assignData.employee_id}
                                        onChange={(e) => setAssignData({ ...assignData, employee_id: e.target.value })}
                                    >
                                        <option value="">Select an employee</option>
                                        {employees.map((emp) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.display_name || 'Unnamed'} {emp.position ? `(${emp.position})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Role</label>
                                    <select
                                        className="input"
                                        value={assignData.role}
                                        onChange={(e) => setAssignData({ ...assignData, role: e.target.value })}
                                    >
                                        <option value="">No specific role</option>
                                        <option value="host">Host</option>
                                        <option value="cleaning">Cleaning</option>
                                        <option value="check-in">Check-in</option>
                                        <option value="support">Support</option>
                                    </select>
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        className="btn-secondary flex-1"
                                        onClick={closeAssignModal}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn-primary flex-1"
                                        disabled={saving}
                                    >
                                        {saving ? 'Assigning...' : 'Assign Staff'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

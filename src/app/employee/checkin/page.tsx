'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createUntypedClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils'
import { useMyNotes, invalidateQueries } from '@/lib/hooks/useData'

interface StaffNote {
    id: string
    note: string
    created_at: string
    events: {
        title: string | null
    }[] | null
}

export default function CheckInToolsPage() {
    const { user } = useAuth()
    const { data: myNotes = [], isLoading: loadingNotes, mutate } = useMyNotes(user?.id)

    // Staff notes state
    const [noteText, setNoteText] = useState('')
    const [savingNote, setSavingNote] = useState(false)

    async function saveNote() {
        if (!noteText.trim() || !user) return

        setSavingNote(true)
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('staff_notes')
                .insert({
                    employee_id: user.id,
                    note: noteText.trim(),
                })

            if (error) throw error
            setNoteText('')
            if (user?.id) invalidateQueries.myNotes(user.id)
            mutate()
        } catch (err) {
            console.error('Error saving note:', err)
            alert('Failed to save note')
        } finally {
            setSavingNote(false)
        }
    }

    return (
        <div className="space-y-4 sm:space-y-6">
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold">Check-In Tools</h1>
                <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                    Add and review staff notes during check-in
                </p>
            </div>
            <div className="space-y-4 sm:space-y-6">
                {/* Add Note Form */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-base sm:text-lg">Add a Note</h2>
                    </div>
                    <div className="card-content space-y-3 sm:space-y-4">
                        <textarea
                            className="input min-h-[80px] sm:min-h-[100px]"
                            placeholder="Write your note here..."
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                        />
                        <button
                            onClick={saveNote}
                            disabled={savingNote || !noteText.trim()}
                            className="btn-primary w-full sm:w-auto"
                        >
                            {savingNote ? 'Saving...' : 'Save Note'}
                        </button>
                    </div>
                </div>

                {/* My Notes */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-lg">My Recent Notes</h2>
                    </div>
                    <div className="card-content">
                        {loadingNotes ? (
                            <div className="space-y-3">
                                {[...Array(3)].map((_, i) => (
                                    <div key={i} className="h-16 bg-muted rounded-lg animate-pulse"></div>
                                ))}
                            </div>
                        ) : myNotes.length === 0 ? (
                            <p className="text-muted-foreground text-center py-4">
                                No notes yet
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {myNotes.map((note: StaffNote) => (
                                    <div
                                        key={note.id}
                                        className="p-4 rounded-lg bg-muted/50"
                                    >
                                        <p className="text-sm">{note.note}</p>
                                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                            <span>{formatDateTime(note.created_at)}</span>
                                            {note.events?.length ? (
                                                <>
                                                    <span>•</span>
                                                    <span>🎉 {note.events[0]?.title || 'Event'}</span>
                                                </>
                                            ) : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

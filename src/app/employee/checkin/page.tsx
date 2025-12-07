'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { createClient, createUntypedClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils'

interface WaiverResult {
    id: string
    phone: string | null
    customer_name: string | null
    signed_at: string | null
    waiver_url: string | null
}

interface StaffNote {
    id: string
    note: string
    created_at: string
    events: {
        title: string
    } | null
}

export default function CheckInToolsPage() {
    const { user } = useAuth()
    const [activeTab, setActiveTab] = useState<'waiver' | 'notes'>('waiver')

    // Waiver search state
    const [phone, setPhone] = useState('')
    const [searchResults, setSearchResults] = useState<WaiverResult[]>([])
    const [searching, setSearching] = useState(false)
    const [searched, setSearched] = useState(false)

    // Staff notes state
    const [noteText, setNoteText] = useState('')
    const [myNotes, setMyNotes] = useState<StaffNote[]>([])
    const [loadingNotes, setLoadingNotes] = useState(false)
    const [savingNote, setSavingNote] = useState(false)

    async function searchWaivers() {
        if (!phone.trim()) return

        setSearching(true)
        setSearched(true)
        try {
            const supabase = createClient()
            const { data, error } = await supabase
                .from('waivers')
                .select('id, phone, customer_name, signed_at, waiver_url')
                .ilike('phone', `%${phone}%`)
                .order('signed_at', { ascending: false })
                .limit(10)

            if (error) throw error
            setSearchResults(data || [])
        } catch (err) {
            console.error('Error searching waivers:', err)
            alert('Failed to search waivers')
        } finally {
            setSearching(false)
        }
    }

    async function loadMyNotes() {
        setLoadingNotes(true)
        try {
            const supabase = createClient()
            const { data, error } = await supabase
                .from('staff_notes')
                .select(`
          id,
          note,
          created_at,
          events (
            title
          )
        `)
                .order('created_at', { ascending: false })
                .limit(20)

            if (error) throw error
            setMyNotes(data || [])
        } catch (err) {
            console.error('Error loading notes:', err)
        } finally {
            setLoadingNotes(false)
        }
    }

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
            await loadMyNotes()
        } catch (err) {
            console.error('Error saving note:', err)
            alert('Failed to save note')
        } finally {
            setSavingNote(false)
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Check-In Tools</h1>
                <p className="text-muted-foreground mt-1">
                    Search waivers and add staff notes
                </p>
            </div>

            {/* Tab navigation */}
            <div className="flex gap-2 border-b">
                <button
                    onClick={() => setActiveTab('waiver')}
                    className={`px-4 py-2 font-medium transition-colors border-b-2 -mb-px ${activeTab === 'waiver'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                >
                    🔍 Waiver Search
                </button>
                <button
                    onClick={() => {
                        setActiveTab('notes')
                        loadMyNotes()
                    }}
                    className={`px-4 py-2 font-medium transition-colors border-b-2 -mb-px ${activeTab === 'notes'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                >
                    📝 Staff Notes
                </button>
            </div>

            {activeTab === 'waiver' ? (
                <div className="space-y-6">
                    {/* Search Form */}
                    <div className="card">
                        <div className="card-header">
                            <h2 className="card-title text-lg">Search Waivers by Phone</h2>
                        </div>
                        <div className="card-content">
                            <div className="flex gap-3">
                                <input
                                    type="tel"
                                    className="input flex-1"
                                    placeholder="Enter phone number..."
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && searchWaivers()}
                                />
                                <button
                                    onClick={searchWaivers}
                                    disabled={searching || !phone.trim()}
                                    className="btn-primary"
                                >
                                    {searching ? 'Searching...' : 'Search'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Search Results */}
                    {searched && (
                        <div className="card">
                            <div className="card-header">
                                <h2 className="card-title text-lg">
                                    Results ({searchResults.length})
                                </h2>
                            </div>
                            <div className="card-content">
                                {searchResults.length === 0 ? (
                                    <p className="text-muted-foreground text-center py-4">
                                        No waivers found for this phone number
                                    </p>
                                ) : (
                                    <div className="space-y-3">
                                        {searchResults.map((waiver) => (
                                            <div
                                                key={waiver.id}
                                                className="p-4 rounded-lg bg-muted/50"
                                            >
                                                <div className="flex items-start justify-between gap-4">
                                                    <div>
                                                        <p className="font-semibold">
                                                            {waiver.customer_name || 'Unknown Customer'}
                                                        </p>
                                                        <p className="text-sm text-muted-foreground">
                                                            📞 {waiver.phone}
                                                        </p>
                                                        {waiver.signed_at && (
                                                            <p className="text-sm text-muted-foreground">
                                                                ✍️ Signed: {formatDateTime(waiver.signed_at)}
                                                            </p>
                                                        )}
                                                    </div>
                                                    {waiver.waiver_url && (
                                                        <a
                                                            href={waiver.waiver_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="btn-outline btn-sm"
                                                        >
                                                            View Waiver
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Add Note Form */}
                    <div className="card">
                        <div className="card-header">
                            <h2 className="card-title text-lg">Add a Note</h2>
                        </div>
                        <div className="card-content space-y-4">
                            <textarea
                                className="input min-h-[100px]"
                                placeholder="Write your note here..."
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                            />
                            <button
                                onClick={saveNote}
                                disabled={savingNote || !noteText.trim()}
                                className="btn-primary"
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
                                    {myNotes.map((note) => (
                                        <div
                                            key={note.id}
                                            className="p-4 rounded-lg bg-muted/50"
                                        >
                                            <p className="text-sm">{note.note}</p>
                                            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                                <span>{formatDateTime(note.created_at)}</span>
                                                {note.events && (
                                                    <>
                                                        <span>•</span>
                                                        <span>🎉 {note.events.title}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

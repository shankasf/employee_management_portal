'use client'

import Chatbot from '@/components/Chatbot'

export default function AdminAssistantPage() {
    return (
        <div className="space-y-4">
            <header>
                <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
                    <span>🤖</span> Admin Assistant
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Multi-agent assistant with live access to employees, attendance, tasks,
                    schedules, onboarding, and events.
                </p>
            </header>
            <Chatbot mode="admin" inline />
        </div>
    )
}

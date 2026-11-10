'use client'

import Chatbot from '@/components/Chatbot'

export default function EmployeeAssistantPage() {
    return (
        <div className="space-y-4">
            <header>
                <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
                    <span>🤖</span> Work Assistant
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Ask about your tasks, schedule, hours, onboarding, or how to do something
                    at work. You can use voice too — tap the microphone.
                </p>
            </header>
            <Chatbot mode="employee" inline />
        </div>
    )
}

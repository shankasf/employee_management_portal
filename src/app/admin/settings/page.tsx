'use client'

import { Suspense } from 'react'
import { CalendarSettings } from '@/components/CalendarSettings'

export default function AdminSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect your own calendar. These settings apply to your account only — employees manage
          theirs from their own Settings page.
        </p>
      </div>

      <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading settings…</div>}>
        <CalendarSettings role="admin" />
      </Suspense>
    </div>
  )
}

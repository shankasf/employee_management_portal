'use client'

import { Suspense } from 'react'
import { CalendarSettings } from '@/components/CalendarSettings'

export default function EmployeeSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect your calendar so your shifts show up wherever you already look.
        </p>
      </div>

      {/* CalendarSettings reads OAuth result params, so it needs a Suspense boundary. */}
      <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading settings…</div>}>
        <CalendarSettings role="employee" />
      </Suspense>
    </div>
  )
}

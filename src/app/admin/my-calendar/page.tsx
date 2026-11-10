'use client'

import { MyCalendar } from '@/components/MyCalendar'

export default function AdminMyCalendarPage() {
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">My Calendar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your own shifts, tasks and events — plus anything from the calendars you have connected.
        </p>
      </div>
      <MyCalendar settingsHref="/admin/settings" />
    </div>
  )
}

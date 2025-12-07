'use client'

import { useState } from 'react'

export default function ReportsPage() {
    const [selectedReport, setSelectedReport] = useState<string | null>(null)

    const reportTypes = [
        {
            id: 'attendance',
            title: 'Attendance Report',
            description: 'View attendance patterns, hours worked, and punctuality',
            icon: '⏰',
        },
        {
            id: 'tasks',
            title: 'Task Completion Report',
            description: 'Track task completion rates and performance',
            icon: '✅',
        },
        {
            id: 'events',
            title: 'Events Report',
            description: 'Review events, staffing, and checklist completion',
            icon: '🎉',
        },
        {
            id: 'employee',
            title: 'Employee Performance',
            description: 'Individual employee metrics and statistics',
            icon: '📊',
        },
    ]

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Reports</h1>
                <p className="text-muted-foreground mt-1">
                    Generate and view detailed reports
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reportTypes.map((report) => (
                    <button
                        key={report.id}
                        onClick={() => setSelectedReport(report.id)}
                        className={`card p-6 text-left hover:shadow-md transition-all ${selectedReport === report.id ? 'ring-2 ring-primary' : ''
                            }`}
                    >
                        <div className="flex items-start gap-4">
                            <span className="text-3xl">{report.icon}</span>
                            <div>
                                <h3 className="font-semibold">{report.title}</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {report.description}
                                </p>
                            </div>
                        </div>
                    </button>
                ))}
            </div>

            {selectedReport && (
                <div className="card">
                    <div className="card-header">
                        <h2 className="card-title text-lg">
                            {reportTypes.find((r) => r.id === selectedReport)?.title}
                        </h2>
                    </div>
                    <div className="card-content">
                        <div className="flex flex-col sm:flex-row gap-4 mb-6">
                            <div className="flex-1">
                                <label className="label mb-2 block">Start Date</label>
                                <input type="date" className="input" />
                            </div>
                            <div className="flex-1">
                                <label className="label mb-2 block">End Date</label>
                                <input type="date" className="input" />
                            </div>
                            <div className="flex items-end">
                                <button className="btn-primary">Generate Report</button>
                            </div>
                        </div>

                        <div className="p-8 text-center border-2 border-dashed rounded-lg">
                            <p className="text-muted-foreground">
                                Select date range and click &quot;Generate Report&quot; to view data
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

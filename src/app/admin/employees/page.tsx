'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
// Utility functions removed - not used

interface Employee {
    id: string
    display_name: string | null
    position: string | null
    shift_type: string | null
    is_active: boolean
    profiles: {
        email: string | null
        full_name: string | null
        role: string
        status: string
    } | null
}

export default function EmployeesPage() {
    const [employees, setEmployees] = useState<Employee[]>([])
    const [loading, setLoading] = useState(true)
    const [showInactive, setShowInactive] = useState(false)

    useEffect(() => {
        loadEmployees()
    }, [showInactive])

    async function loadEmployees() {
        setLoading(true)
        try {
            const supabase = createClient()
            let query = supabase
                .from('employees')
                .select(`
          *,
          profiles (
            email,
            full_name,
            role,
            status
          )
        `)
                .order('display_name')

            if (!showInactive) {
                query = query.eq('is_active', true)
            }

            const { data, error } = await query
            if (error) throw error
            setEmployees(data || [])
        } catch (err) {
            console.error('Error loading employees:', err)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Employees</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage your team members
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={showInactive}
                            onChange={(e) => setShowInactive(e.target.checked)}
                            className="rounded border-gray-300"
                        />
                        Show inactive
                    </label>
                    <button className="btn-primary">
                        + Add Employee
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-20 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : employees.length === 0 ? (
                <div className="card p-8 text-center">
                    <p className="text-muted-foreground">No employees found</p>
                </div>
            ) : (
                <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="text-left p-4 font-medium">Employee</th>
                                    <th className="text-left p-4 font-medium">Position</th>
                                    <th className="text-left p-4 font-medium">Shift Type</th>
                                    <th className="text-left p-4 font-medium">Role</th>
                                    <th className="text-left p-4 font-medium">Status</th>
                                    <th className="text-left p-4 font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {employees.map((emp) => (
                                    <tr key={emp.id} className="hover:bg-muted/30">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold">
                                                    {emp.display_name?.[0] || emp.profiles?.full_name?.[0] || 'E'}
                                                </div>
                                                <div>
                                                    <p className="font-medium">{emp.display_name || emp.profiles?.full_name || 'Unknown'}</p>
                                                    <p className="text-sm text-muted-foreground">{emp.profiles?.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">{emp.position || '-'}</td>
                                        <td className="p-4">{emp.shift_type || '-'}</td>
                                        <td className="p-4">
                                            <span className={`badge ${emp.profiles?.role === 'admin' ? 'badge-default' : 'badge-secondary'}`}>
                                                {emp.profiles?.role || 'employee'}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`badge ${emp.is_active ? 'badge-success' : 'badge-secondary'}`}>
                                                {emp.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <button className="btn-ghost btn-sm">Edit</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}

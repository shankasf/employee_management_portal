'use client'

import { useEffect, useState } from 'react'
import { createUntypedClient } from '@/lib/supabase/client'

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
        email_confirmed_at: string | null
    } | null
}

export default function EmployeesPage() {
    const [employees, setEmployees] = useState<Employee[]>([])
    const [loading, setLoading] = useState(true)
    const [showInactive, setShowInactive] = useState(false)
    const [showModal, setShowModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
    const [saving, setSaving] = useState(false)
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        full_name: '',
        display_name: '',
        position: '',
        shift_type: 'full-time',
        role: 'employee'
    })
    const [editFormData, setEditFormData] = useState({
        display_name: '',
        position: '',
        shift_type: 'full-time',
        role: 'employee',
        is_active: true
    })

    function openEditModal(emp: Employee) {
        setEditingEmployee(emp)
        setEditFormData({
            display_name: emp.display_name || '',
            position: emp.position || '',
            shift_type: emp.shift_type || 'full-time',
            role: emp.profiles?.role || 'employee',
            is_active: emp.is_active
        })
        setShowEditModal(true)
    }

    async function handleEditSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!editingEmployee) return
        setSaving(true)
        try {
            const supabase = createUntypedClient()

            // Update employee table
            const { error: empError } = await supabase
                .from('employees')
                .update({
                    display_name: editFormData.display_name || null,
                    position: editFormData.position || null,
                    shift_type: editFormData.shift_type,
                    is_active: editFormData.is_active
                })
                .eq('id', editingEmployee.id)

            if (empError) throw empError

            // Update profile role if changed
            if (editFormData.role !== editingEmployee.profiles?.role) {
                const { error: profileError } = await supabase
                    .from('profiles')
                    .update({ role: editFormData.role })
                    .eq('id', editingEmployee.id)

                if (profileError) throw profileError
            }

            alert('Employee updated successfully!')
            setShowEditModal(false)
            setEditingEmployee(null)
            loadEmployees()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error updating employee:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    useEffect(() => {
        loadEmployees()
    }, [showInactive])

    async function loadEmployees() {
        setLoading(true)
        try {
            const supabase = createUntypedClient()
            let query = supabase
                .from('employees')
                .select(`
          *,
          profiles (
            email,
            full_name,
            role,
            status,
            email_confirmed_at
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
                    <button className="btn-primary" onClick={() => setShowModal(true)}>
                        + Add Employee
                    </button>
                </div>
            </div>

            {/* Add Employee Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md mx-4 p-6">
                        <h2 className="text-xl font-bold mb-4">Add New Employee</h2>
                        <form onSubmit={async (e) => {
                            e.preventDefault()
                            setSaving(true)
                            try {
                                const supabase = createUntypedClient()

                                // Create auth user
                                const { data: authData, error: authError } = await supabase.auth.signUp({
                                    email: formData.email,
                                    password: formData.password,
                                    options: {
                                        data: {
                                            full_name: formData.full_name,
                                            role: formData.role
                                        }
                                    }
                                })

                                if (authError) throw authError
                                if (!authData.user) throw new Error('User not created')

                                const userId = authData.user.id

                                // Create profile
                                const { error: profileError } = await supabase
                                    .from('profiles')
                                    .insert({
                                        id: userId,
                                        email: formData.email,
                                        full_name: formData.full_name,
                                        role: formData.role,
                                        status: 'active'
                                    })

                                if (profileError) throw profileError

                                // Create employee
                                const { error: empError } = await supabase
                                    .from('employees')
                                    .insert({
                                        id: userId,
                                        display_name: formData.display_name || formData.full_name,
                                        position: formData.position,
                                        shift_type: formData.shift_type,
                                        is_active: true
                                    })

                                if (empError) throw empError

                                alert('Employee added successfully!')
                                setShowModal(false)
                                setFormData({
                                    email: '',
                                    password: '',
                                    full_name: '',
                                    display_name: '',
                                    position: '',
                                    shift_type: 'full-time',
                                    role: 'employee'
                                })
                                loadEmployees()
                            } catch (err: unknown) {
                                const error = err as Error
                                console.error('Error adding employee:', error)
                                alert('Error: ' + error.message)
                            } finally {
                                setSaving(false)
                            }
                        }} className="space-y-4">
                            <div>
                                <label className="label">Email *</label>
                                <input
                                    type="email"
                                    required
                                    className="input"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="label">Password *</label>
                                <input
                                    type="password"
                                    required
                                    minLength={6}
                                    className="input"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="label">Full Name *</label>
                                <input
                                    type="text"
                                    required
                                    className="input"
                                    value={formData.full_name}
                                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="label">Display Name</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="Short name for UI"
                                    value={formData.display_name}
                                    onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="label">Position</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="e.g., Floor Staff, Manager"
                                    value={formData.position}
                                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Shift Type</label>
                                    <select
                                        className="input"
                                        value={formData.shift_type}
                                        onChange={(e) => setFormData({ ...formData, shift_type: e.target.value })}
                                    >
                                        <option value="full-time">Full-time</option>
                                        <option value="part-time">Part-time</option>
                                        <option value="weekend">Weekend</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Role</label>
                                    <select
                                        className="input"
                                        value={formData.role}
                                        onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                    >
                                        <option value="employee">Employee</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    className="btn-secondary flex-1"
                                    onClick={() => setShowModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary flex-1"
                                    disabled={saving}
                                >
                                    {saving ? 'Adding...' : 'Add Employee'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Employee Modal */}
            {showEditModal && editingEmployee && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md mx-4 p-6">
                        <h2 className="text-xl font-bold mb-4">Edit Employee</h2>
                        <p className="text-sm text-muted-foreground mb-4">
                            {editingEmployee.profiles?.full_name} ({editingEmployee.profiles?.email})
                        </p>
                        <form onSubmit={handleEditSubmit} className="space-y-4">
                            <div>
                                <label className="label">Display Name</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="Short name for UI"
                                    value={editFormData.display_name}
                                    onChange={(e) => setEditFormData({ ...editFormData, display_name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="label">Position</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="e.g., Floor Staff, Manager"
                                    value={editFormData.position}
                                    onChange={(e) => setEditFormData({ ...editFormData, position: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Shift Type</label>
                                    <select
                                        className="input"
                                        value={editFormData.shift_type}
                                        onChange={(e) => setEditFormData({ ...editFormData, shift_type: e.target.value })}
                                    >
                                        <option value="full-time">Full-time</option>
                                        <option value="part-time">Part-time</option>
                                        <option value="weekend">Weekend</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Role</label>
                                    <select
                                        className="input"
                                        value={editFormData.role}
                                        onChange={(e) => setEditFormData({ ...editFormData, role: e.target.value })}
                                    >
                                        <option value="employee">Employee</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={editFormData.is_active}
                                        onChange={(e) => setEditFormData({ ...editFormData, is_active: e.target.checked })}
                                        className="rounded border-gray-300"
                                    />
                                    <span className="text-sm">Active</span>
                                </label>
                            </div>
                            <div className="flex gap-3 pt-4">
                                <button
                                    type="button"
                                    className="btn-secondary flex-1"
                                    onClick={() => { setShowEditModal(false); setEditingEmployee(null); }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary flex-1"
                                    disabled={saving}
                                >
                                    {saving ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

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
                                    <th className="text-left p-4 font-medium">Email Verified</th>
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
                                            <span className={`badge ${emp.profiles?.email_confirmed_at ? 'badge-success' : 'badge-warning'}`}>
                                                {emp.profiles?.email_confirmed_at ? 'Yes' : 'No'}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`badge ${emp.is_active ? 'badge-success' : 'badge-secondary'}`}>
                                                {emp.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <button
                                                className="btn-ghost btn-sm"
                                                onClick={() => openEditModal(emp)}
                                            >
                                                Edit
                                            </button>
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

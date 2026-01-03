'use client'

import { useState } from 'react'
import { createUntypedClient } from '@/lib/supabase/client'
import { useEmployees, invalidateQueries } from '@/lib/hooks/useData'
import { IdDocumentType } from '@/types/supabase'

interface Employee {
    id: string
    display_name: string | null
    position: string | null
    shift_type: string | null
    shift_start: string | null
    shift_end: string | null
    company_name: string | null
    work_location: string | null
    date_of_birth: string | null
    phone_number: string | null
    street_address: string | null
    city: string | null
    state: string | null
    zip_code: string | null
    country: string | null
    id_document_type: IdDocumentType | null
    id_document_number: string | null
    id_document_expiry: string | null
    id_document_url: string | null
    emergency_contact_name: string | null
    emergency_contact_phone: string | null
    hr_notes: string | null
    is_active: boolean
    profiles: {
        email: string | null
        full_name: string | null
        role: string
        status: string
        email_confirmed_at: string | null
    } | null
}

const defaultFormData = {
    email: '',
    password: '',
    full_name: '',
    display_name: '',
    position: '',
    shift_type: 'full-time',
    shift_start: '',
    shift_end: '',
    company_name: '',
    work_location: '',
    date_of_birth: '',
    phone_number: '',
    street_address: '',
    city: '',
    state: '',
    zip_code: '',
    country: 'USA',
    id_document_type: '' as IdDocumentType | '',
    id_document_number: '',
    id_document_expiry: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    hr_notes: '',
    role: 'employee'
}

const defaultEditFormData = {
    display_name: '',
    position: '',
    shift_type: 'full-time',
    shift_start: '',
    shift_end: '',
    company_name: '',
    work_location: '',
    date_of_birth: '',
    phone_number: '',
    street_address: '',
    city: '',
    state: '',
    zip_code: '',
    country: 'USA',
    id_document_type: '' as IdDocumentType | '',
    id_document_number: '',
    id_document_expiry: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    hr_notes: '',
    role: 'employee',
    is_active: true
}

export default function EmployeesPage() {
    const [showInactive, setShowInactive] = useState(false)
    const { data: employees = [], isLoading: loading, mutate } = useEmployees(showInactive)
    const [showModal, setShowModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [showViewModal, setShowViewModal] = useState(false)
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
    const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null)
    const [saving, setSaving] = useState(false)
    const [formData, setFormData] = useState(defaultFormData)
    const [editFormData, setEditFormData] = useState(defaultEditFormData)
    const [activeTab, setActiveTab] = useState<'basic' | 'address' | 'id' | 'hr'>('basic')

    // Delete state
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null)
    const [deleteType, setDeleteType] = useState<'deactivate' | 'permanent'>('deactivate')
    const [deleteConfirmed, setDeleteConfirmed] = useState(false)
    const [deleting, setDeleting] = useState(false)

    function openEditModal(emp: Employee) {
        setEditingEmployee(emp)
        setEditFormData({
            display_name: emp.display_name || '',
            position: emp.position || '',
            shift_type: emp.shift_type || 'full-time',
            shift_start: emp.shift_start || '',
            shift_end: emp.shift_end || '',
            company_name: emp.company_name || '',
            work_location: emp.work_location || '',
            date_of_birth: emp.date_of_birth || '',
            phone_number: emp.phone_number || '',
            street_address: emp.street_address || '',
            city: emp.city || '',
            state: emp.state || '',
            zip_code: emp.zip_code || '',
            country: emp.country || 'USA',
            id_document_type: emp.id_document_type || '',
            id_document_number: emp.id_document_number || '',
            id_document_expiry: emp.id_document_expiry || '',
            emergency_contact_name: emp.emergency_contact_name || '',
            emergency_contact_phone: emp.emergency_contact_phone || '',
            hr_notes: emp.hr_notes || '',
            role: emp.profiles?.role || 'employee',
            is_active: emp.is_active
        })
        setActiveTab('basic')
        setShowEditModal(true)
    }

    function openViewModal(emp: Employee) {
        setViewingEmployee(emp)
        setShowViewModal(true)
    }

    function openDeleteModal(emp: Employee, type: 'deactivate' | 'permanent') {
        setDeletingEmployee(emp)
        setDeleteType(type)
        setDeleteConfirmed(false)
        setShowDeleteModal(true)
    }

    async function handleDeactivate() {
        if (!deletingEmployee || !deleteConfirmed) return
        setDeleting(true)
        try {
            const supabase = createUntypedClient()
            const { error } = await supabase
                .from('employees')
                .update({ is_active: false })
                .eq('id', deletingEmployee.id)

            if (error) throw error

            alert('Employee deactivated successfully!')
            setShowDeleteModal(false)
            setShowViewModal(false)
            setDeletingEmployee(null)
            setDeleteConfirmed(false)
            invalidateQueries.employees()
            mutate()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error deactivating employee:', error)
            alert('Error: ' + error.message)
        } finally {
            setDeleting(false)
        }
    }

    async function handlePermanentDelete() {
        if (!deletingEmployee || !deleteConfirmed) return
        setDeleting(true)
        try {
            const response = await fetch(`/api/admin/employees?id=${deletingEmployee.id}`, {
                method: 'DELETE',
            })

            const result = await response.json()

            if (!response.ok) {
                throw new Error(result.error || 'Failed to delete employee')
            }

            alert('Employee permanently deleted!')
            setShowDeleteModal(false)
            setShowViewModal(false)
            setDeletingEmployee(null)
            setDeleteConfirmed(false)
            invalidateQueries.employees()
            mutate()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error deleting employee:', error)
            alert('Error: ' + error.message)
        } finally {
            setDeleting(false)
        }
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
                    shift_start: editFormData.shift_start || null,
                    shift_end: editFormData.shift_end || null,
                    company_name: editFormData.company_name || null,
                    work_location: editFormData.work_location || null,
                    date_of_birth: editFormData.date_of_birth || null,
                    phone_number: editFormData.phone_number || null,
                    street_address: editFormData.street_address || null,
                    city: editFormData.city || null,
                    state: editFormData.state || null,
                    zip_code: editFormData.zip_code || null,
                    country: editFormData.country || null,
                    id_document_type: editFormData.id_document_type || null,
                    id_document_number: editFormData.id_document_number || null,
                    id_document_expiry: editFormData.id_document_expiry || null,
                    emergency_contact_name: editFormData.emergency_contact_name || null,
                    emergency_contact_phone: editFormData.emergency_contact_phone || null,
                    hr_notes: editFormData.hr_notes || null,
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
            invalidateQueries.employees()
            mutate()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error updating employee:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    async function handleAddSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        try {
            const response = await fetch('/api/admin/employees', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: formData.email,
                    password: formData.password,
                    full_name: formData.full_name,
                    display_name: formData.display_name,
                    position: formData.position,
                    shift_type: formData.shift_type,
                    shift_start: formData.shift_start || null,
                    shift_end: formData.shift_end || null,
                    company_name: formData.company_name || null,
                    work_location: formData.work_location || null,
                    date_of_birth: formData.date_of_birth || null,
                    phone_number: formData.phone_number || null,
                    street_address: formData.street_address || null,
                    city: formData.city || null,
                    state: formData.state || null,
                    zip_code: formData.zip_code || null,
                    country: formData.country || null,
                    id_document_type: formData.id_document_type || null,
                    id_document_number: formData.id_document_number || null,
                    id_document_expiry: formData.id_document_expiry || null,
                    emergency_contact_name: formData.emergency_contact_name || null,
                    emergency_contact_phone: formData.emergency_contact_phone || null,
                    hr_notes: formData.hr_notes || null,
                    role: formData.role
                }),
            })

            const result = await response.json()

            if (!response.ok) {
                throw new Error(result.error || 'Failed to create employee')
            }

            alert('Employee added successfully!')
            setShowModal(false)
            setFormData(defaultFormData)
            setActiveTab('basic')
            invalidateQueries.employees()
            mutate()
        } catch (err: unknown) {
            const error = err as Error
            console.error('Error adding employee:', error)
            alert('Error: ' + error.message)
        } finally {
            setSaving(false)
        }
    }

    const TabButton = ({ tab, label }: { tab: 'basic' | 'address' | 'id' | 'hr', label: string }) => (
        <button
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg ${activeTab === tab
                ? 'bg-card text-foreground border-b-2 border-primary'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
        >
            {label}
        </button>
    )

    const FormTabs = () => (
        <div className="flex gap-1 border-b mb-4">
            <TabButton tab="basic" label="Basic Info" />
            <TabButton tab="address" label="Address" />
            <TabButton tab="id" label="ID Docs" />
            <TabButton tab="hr" label="HR" />
        </div>
    )

    return (
        <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">Employees</h1>
                    <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                        Manage your team members
                    </p>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                    <label className="flex items-center gap-2 text-xs sm:text-sm">
                        <input
                            type="checkbox"
                            checked={showInactive}
                            onChange={(e) => setShowInactive(e.target.checked)}
                            className="rounded border-gray-300"
                        />
                        <span className="whitespace-nowrap">Show inactive</span>
                    </label>
                    <button className="btn-primary flex-1 sm:flex-none text-xs sm:text-sm" onClick={() => { setShowModal(true); setActiveTab('basic'); }}>
                        + Add Employee
                    </button>
                </div>
            </div>

            {/* Add Employee Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-4 sm:p-6">
                            <h2 className="text-lg sm:text-xl font-bold mb-4">Add New Employee</h2>
                            <form onSubmit={handleAddSubmit} className="space-y-4">
                                <FormTabs />

                                {activeTab === 'basic' && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Email *</label>
                                                <input type="email" required className="input" value={formData.email}
                                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Password *</label>
                                                <input type="password" required minLength={6} className="input" value={formData.password}
                                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Full Name *</label>
                                                <input type="text" required className="input" value={formData.full_name}
                                                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Display Name</label>
                                                <input type="text" className="input" placeholder="Short name" value={formData.display_name}
                                                    onChange={(e) => setFormData({ ...formData, display_name: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Phone Number *</label>
                                                <input type="tel" required className="input" value={formData.phone_number}
                                                    onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Date of Birth *</label>
                                                <input type="date" required className="input" value={formData.date_of_birth}
                                                    onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Position</label>
                                                <input type="text" className="input" placeholder="e.g., Floor Staff" value={formData.position}
                                                    onChange={(e) => setFormData({ ...formData, position: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Role</label>
                                                <select className="input" value={formData.role}
                                                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}>
                                                    <option value="employee">Employee</option>
                                                    <option value="admin">Admin</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                            <div>
                                                <label className="label">Shift Type</label>
                                                <select className="input" value={formData.shift_type}
                                                    onChange={(e) => setFormData({ ...formData, shift_type: e.target.value })}>
                                                    <option value="full-time">Full-time</option>
                                                    <option value="part-time">Part-time</option>
                                                    <option value="weekend">Weekend</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="label">Shift Start</label>
                                                <input type="time" className="input" value={formData.shift_start}
                                                    onChange={(e) => setFormData({ ...formData, shift_start: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Shift End</label>
                                                <input type="time" className="input" value={formData.shift_end}
                                                    onChange={(e) => setFormData({ ...formData, shift_end: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Company Name</label>
                                                <input type="text" className="input" value={formData.company_name}
                                                    onChange={(e) => setFormData({ ...formData, company_name: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Work Location</label>
                                                <input type="text" className="input" value={formData.work_location}
                                                    onChange={(e) => setFormData({ ...formData, work_location: e.target.value })} />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'address' && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="label">Street Address *</label>
                                            <input type="text" required className="input" value={formData.street_address}
                                                onChange={(e) => setFormData({ ...formData, street_address: e.target.value })} />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">City *</label>
                                                <input type="text" required className="input" value={formData.city}
                                                    onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">State *</label>
                                                <input type="text" required className="input" value={formData.state}
                                                    onChange={(e) => setFormData({ ...formData, state: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">ZIP Code *</label>
                                                <input type="text" required className="input" value={formData.zip_code}
                                                    onChange={(e) => setFormData({ ...formData, zip_code: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Country</label>
                                                <input type="text" className="input" value={formData.country}
                                                    onChange={(e) => setFormData({ ...formData, country: e.target.value })} />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'id' && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="label">ID Document Type *</label>
                                            <select required className="input" value={formData.id_document_type}
                                                onChange={(e) => setFormData({ ...formData, id_document_type: e.target.value as IdDocumentType })}>
                                                <option value="">Select type...</option>
                                                <option value="drivers_license">Driver&apos;s License</option>
                                                <option value="passport">Passport</option>
                                                <option value="state_id">State ID</option>
                                                <option value="other">Other</option>
                                            </select>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Document Number *</label>
                                                <input type="text" required className="input" value={formData.id_document_number}
                                                    onChange={(e) => setFormData({ ...formData, id_document_number: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Expiry Date</label>
                                                <input type="date" className="input" value={formData.id_document_expiry}
                                                    onChange={(e) => setFormData({ ...formData, id_document_expiry: e.target.value })} />
                                            </div>
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            Document upload can be done after creating the employee.
                                        </p>
                                    </div>
                                )}

                                {activeTab === 'hr' && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Emergency Contact Name</label>
                                                <input type="text" className="input" value={formData.emergency_contact_name}
                                                    onChange={(e) => setFormData({ ...formData, emergency_contact_name: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Emergency Contact Phone</label>
                                                <input type="tel" className="input" value={formData.emergency_contact_phone}
                                                    onChange={(e) => setFormData({ ...formData, emergency_contact_phone: e.target.value })} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="label">HR Notes</label>
                                            <textarea className="input min-h-[100px]" value={formData.hr_notes}
                                                onChange={(e) => setFormData({ ...formData, hr_notes: e.target.value })} />
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-3 pt-4 border-t">
                                    <button type="button" className="btn-secondary flex-1" onClick={() => setShowModal(false)}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn-primary flex-1" disabled={saving}>
                                        {saving ? 'Adding...' : 'Add Employee'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Employee Modal */}
            {showEditModal && editingEmployee && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-4 sm:p-6">
                            <h2 className="text-lg sm:text-xl font-bold mb-2">Edit Employee</h2>
                            <p className="text-sm text-muted-foreground mb-4">
                                {editingEmployee.profiles?.full_name} ({editingEmployee.profiles?.email})
                            </p>
                            <form onSubmit={handleEditSubmit} className="space-y-4">
                                <FormTabs />

                                {activeTab === 'basic' && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Display Name</label>
                                                <input type="text" className="input" value={editFormData.display_name}
                                                    onChange={(e) => setEditFormData({ ...editFormData, display_name: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Phone Number</label>
                                                <input type="tel" className="input" value={editFormData.phone_number}
                                                    onChange={(e) => setEditFormData({ ...editFormData, phone_number: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Date of Birth</label>
                                                <input type="date" className="input" value={editFormData.date_of_birth}
                                                    onChange={(e) => setEditFormData({ ...editFormData, date_of_birth: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Position</label>
                                                <input type="text" className="input" value={editFormData.position}
                                                    onChange={(e) => setEditFormData({ ...editFormData, position: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Role</label>
                                                <select className="input" value={editFormData.role}
                                                    onChange={(e) => setEditFormData({ ...editFormData, role: e.target.value })}>
                                                    <option value="employee">Employee</option>
                                                    <option value="admin">Admin</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="flex items-center gap-2 mt-6">
                                                    <input type="checkbox" checked={editFormData.is_active}
                                                        onChange={(e) => setEditFormData({ ...editFormData, is_active: e.target.checked })}
                                                        className="rounded border-gray-300" />
                                                    <span className="text-sm">Active Employee</span>
                                                </label>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                            <div>
                                                <label className="label">Shift Type</label>
                                                <select className="input" value={editFormData.shift_type}
                                                    onChange={(e) => setEditFormData({ ...editFormData, shift_type: e.target.value })}>
                                                    <option value="full-time">Full-time</option>
                                                    <option value="part-time">Part-time</option>
                                                    <option value="weekend">Weekend</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="label">Shift Start</label>
                                                <input type="time" className="input" value={editFormData.shift_start}
                                                    onChange={(e) => setEditFormData({ ...editFormData, shift_start: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Shift End</label>
                                                <input type="time" className="input" value={editFormData.shift_end}
                                                    onChange={(e) => setEditFormData({ ...editFormData, shift_end: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Company Name</label>
                                                <input type="text" className="input" value={editFormData.company_name}
                                                    onChange={(e) => setEditFormData({ ...editFormData, company_name: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Work Location</label>
                                                <input type="text" className="input" value={editFormData.work_location}
                                                    onChange={(e) => setEditFormData({ ...editFormData, work_location: e.target.value })} />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'address' && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="label">Street Address</label>
                                            <input type="text" className="input" value={editFormData.street_address}
                                                onChange={(e) => setEditFormData({ ...editFormData, street_address: e.target.value })} />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">City</label>
                                                <input type="text" className="input" value={editFormData.city}
                                                    onChange={(e) => setEditFormData({ ...editFormData, city: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">State</label>
                                                <input type="text" className="input" value={editFormData.state}
                                                    onChange={(e) => setEditFormData({ ...editFormData, state: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">ZIP Code</label>
                                                <input type="text" className="input" value={editFormData.zip_code}
                                                    onChange={(e) => setEditFormData({ ...editFormData, zip_code: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Country</label>
                                                <input type="text" className="input" value={editFormData.country}
                                                    onChange={(e) => setEditFormData({ ...editFormData, country: e.target.value })} />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'id' && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="label">ID Document Type</label>
                                            <select className="input" value={editFormData.id_document_type}
                                                onChange={(e) => setEditFormData({ ...editFormData, id_document_type: e.target.value as IdDocumentType })}>
                                                <option value="">Select type...</option>
                                                <option value="drivers_license">Driver&apos;s License</option>
                                                <option value="passport">Passport</option>
                                                <option value="state_id">State ID</option>
                                                <option value="other">Other</option>
                                            </select>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Document Number</label>
                                                <input type="text" className="input" value={editFormData.id_document_number}
                                                    onChange={(e) => setEditFormData({ ...editFormData, id_document_number: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Expiry Date</label>
                                                <input type="date" className="input" value={editFormData.id_document_expiry}
                                                    onChange={(e) => setEditFormData({ ...editFormData, id_document_expiry: e.target.value })} />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'hr' && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="label">Emergency Contact Name</label>
                                                <input type="text" className="input" value={editFormData.emergency_contact_name}
                                                    onChange={(e) => setEditFormData({ ...editFormData, emergency_contact_name: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="label">Emergency Contact Phone</label>
                                                <input type="tel" className="input" value={editFormData.emergency_contact_phone}
                                                    onChange={(e) => setEditFormData({ ...editFormData, emergency_contact_phone: e.target.value })} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="label">HR Notes</label>
                                            <textarea className="input min-h-[100px]" value={editFormData.hr_notes}
                                                onChange={(e) => setEditFormData({ ...editFormData, hr_notes: e.target.value })} />
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-3 pt-4 border-t">
                                    <button type="button" className="btn-secondary flex-1"
                                        onClick={() => { setShowEditModal(false); setEditingEmployee(null); }}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn-primary flex-1" disabled={saving}>
                                        {saving ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* View Employee Modal */}
            {showViewModal && viewingEmployee && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-4 sm:p-6">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h2 className="text-lg sm:text-xl font-bold">{viewingEmployee.display_name || viewingEmployee.profiles?.full_name}</h2>
                                    <p className="text-sm text-muted-foreground">{viewingEmployee.profiles?.email}</p>
                                </div>
                                <button onClick={() => setShowViewModal(false)} className="text-muted-foreground hover:text-foreground">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <h3 className="font-semibold mb-2">Work Details</h3>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div><span className="text-muted-foreground">Position:</span> {viewingEmployee.position || '-'}</div>
                                        <div><span className="text-muted-foreground">Shift:</span> {viewingEmployee.shift_type || '-'}</div>
                                        <div><span className="text-muted-foreground">Shift Time:</span> {viewingEmployee.shift_start && viewingEmployee.shift_end
                                            ? `${viewingEmployee.shift_start} - ${viewingEmployee.shift_end}` : '-'}</div>
                                        <div><span className="text-muted-foreground">Company:</span> {viewingEmployee.company_name || '-'}</div>
                                        <div><span className="text-muted-foreground">Location:</span> {viewingEmployee.work_location || '-'}</div>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="font-semibold mb-2">Personal Details</h3>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div><span className="text-muted-foreground">Phone:</span> {viewingEmployee.phone_number || '-'}</div>
                                        <div><span className="text-muted-foreground">DOB:</span> {viewingEmployee.date_of_birth || '-'}</div>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="font-semibold mb-2">Address</h3>
                                    <p className="text-sm">
                                        {viewingEmployee.street_address ? (
                                            <>
                                                {viewingEmployee.street_address}<br />
                                                {viewingEmployee.city}, {viewingEmployee.state} {viewingEmployee.zip_code}<br />
                                                {viewingEmployee.country}
                                            </>
                                        ) : '-'}
                                    </p>
                                </div>

                                <div>
                                    <h3 className="font-semibold mb-2">ID Document</h3>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div><span className="text-muted-foreground">Type:</span> {viewingEmployee.id_document_type?.replace('_', ' ') || '-'}</div>
                                        <div><span className="text-muted-foreground">Number:</span> {viewingEmployee.id_document_number || '-'}</div>
                                        <div><span className="text-muted-foreground">Expiry:</span> {viewingEmployee.id_document_expiry || '-'}</div>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="font-semibold mb-2">Emergency Contact</h3>
                                    <div className="text-sm">
                                        <div>{viewingEmployee.emergency_contact_name || '-'}</div>
                                        <div className="text-muted-foreground">{viewingEmployee.emergency_contact_phone || ''}</div>
                                    </div>
                                </div>

                                {viewingEmployee.hr_notes && (
                                    <div>
                                        <h3 className="font-semibold mb-2">HR Notes</h3>
                                        <p className="text-sm text-muted-foreground">{viewingEmployee.hr_notes}</p>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col gap-3 pt-4 mt-4 border-t">
                                <div className="flex gap-3">
                                    <button className="btn-secondary flex-1" onClick={() => setShowViewModal(false)}>
                                        Close
                                    </button>
                                    <button className="btn-primary flex-1" onClick={() => { setShowViewModal(false); openEditModal(viewingEmployee); }}>
                                        Edit
                                    </button>
                                </div>
                                <div className="flex gap-3">
                                    {viewingEmployee.is_active && (
                                        <button
                                            className="btn-secondary flex-1 text-yellow-600 border-yellow-600 hover:bg-yellow-50"
                                            onClick={() => openDeleteModal(viewingEmployee, 'deactivate')}
                                        >
                                            Deactivate
                                        </button>
                                    )}
                                    <button
                                        className="flex-1 px-4 py-2 text-sm font-medium text-red-600 border border-red-600 rounded-lg hover:bg-red-50"
                                        onClick={() => openDeleteModal(viewingEmployee, 'permanent')}
                                    >
                                        Delete Permanently
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && deletingEmployee && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-card rounded-lg shadow-lg w-full max-w-md">
                        <div className="p-4 sm:p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${deleteType === 'permanent' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600'
                                    }`}>
                                    {deleteType === 'permanent' ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                        </svg>
                                    )}
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold">
                                        {deleteType === 'permanent' ? 'Permanently Delete Employee' : 'Deactivate Employee'}
                                    </h2>
                                    <p className="text-sm text-muted-foreground">
                                        {deletingEmployee.display_name || deletingEmployee.profiles?.full_name}
                                    </p>
                                </div>
                            </div>

                            <div className={`p-3 rounded-lg mb-4 ${deleteType === 'permanent' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'
                                }`}>
                                {deleteType === 'permanent' ? (
                                    <p className="text-sm text-red-800">
                                        <strong>Warning:</strong> This action cannot be undone. The employee&apos;s account, all their data including attendance records, task history, and schedules will be permanently deleted.
                                    </p>
                                ) : (
                                    <p className="text-sm text-yellow-800">
                                        <strong>Note:</strong> Deactivating will prevent the employee from logging in. Their data will be preserved and they can be reactivated later.
                                    </p>
                                )}
                            </div>

                            <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50">
                                <input
                                    type="checkbox"
                                    checked={deleteConfirmed}
                                    onChange={(e) => setDeleteConfirmed(e.target.checked)}
                                    className="mt-0.5 rounded border-gray-300"
                                />
                                <span className="text-sm">
                                    {deleteType === 'permanent'
                                        ? 'I understand this action is permanent and cannot be undone'
                                        : 'I confirm I want to deactivate this employee'}
                                </span>
                            </label>

                            <div className="flex gap-3 mt-6">
                                <button
                                    type="button"
                                    className="btn-secondary flex-1"
                                    onClick={() => {
                                        setShowDeleteModal(false)
                                        setDeletingEmployee(null)
                                        setDeleteConfirmed(false)
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${deleteType === 'permanent'
                                        ? 'bg-red-600 hover:bg-red-700'
                                        : 'bg-yellow-600 hover:bg-yellow-700'
                                        }`}
                                    disabled={!deleteConfirmed || deleting}
                                    onClick={deleteType === 'permanent' ? handlePermanentDelete : handleDeactivate}
                                >
                                    {deleting
                                        ? (deleteType === 'permanent' ? 'Deleting...' : 'Deactivating...')
                                        : (deleteType === 'permanent' ? 'Delete Permanently' : 'Deactivate')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="space-y-3 sm:space-y-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-16 sm:h-20 bg-muted rounded-lg animate-pulse"></div>
                    ))}
                </div>
            ) : employees.length === 0 ? (
                <div className="card p-6 sm:p-8 text-center">
                    <p className="text-muted-foreground text-sm sm:text-base">No employees found</p>
                </div>
            ) : (
                <>
                    {/* Mobile Card View */}
                    <div className="block sm:hidden space-y-3">
                        {employees.map((emp: Employee) => (
                            <div key={emp.id} className="card p-4" onClick={() => openViewModal(emp)}>
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold flex-shrink-0">
                                        {emp.display_name?.[0] || emp.profiles?.full_name?.[0] || 'E'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{emp.display_name || emp.profiles?.full_name || 'Unknown'}</p>
                                        <p className="text-xs text-muted-foreground truncate">{emp.profiles?.email}</p>
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            <span className="badge badge-secondary text-xs">{emp.position || 'No position'}</span>
                                            <span className={`badge ${emp.is_active ? 'badge-success' : 'badge-secondary'} text-xs`}>
                                                {emp.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                            <span className={`badge ${emp.profiles?.role === 'admin' ? 'badge-default' : 'badge-outline'} text-xs`}>
                                                {emp.profiles?.role || 'employee'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            className="btn-ghost btn-sm text-xs"
                                            onClick={(e) => { e.stopPropagation(); openEditModal(emp); }}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="btn-ghost btn-sm text-xs text-red-600"
                                            onClick={(e) => { e.stopPropagation(); openDeleteModal(emp, 'permanent'); }}
                                            title="Delete"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Desktop Table View */}
                    <div className="card overflow-hidden hidden sm:block">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[800px]">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Employee</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Position</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Shift</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Location</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Role</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Status</th>
                                        <th className="text-left p-3 sm:p-4 font-medium text-sm">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {employees.map((emp: Employee) => (
                                        <tr key={emp.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => openViewModal(emp)}>
                                            <td className="p-3 sm:p-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm">
                                                        {emp.display_name?.[0] || emp.profiles?.full_name?.[0] || 'E'}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-sm truncate">{emp.display_name || emp.profiles?.full_name || 'Unknown'}</p>
                                                        <p className="text-xs text-muted-foreground truncate">{emp.profiles?.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-3 sm:p-4 text-sm">{emp.position || '-'}</td>
                                            <td className="p-3 sm:p-4 text-sm">
                                                <div>{emp.shift_type || '-'}</div>
                                                {emp.shift_start && emp.shift_end && (
                                                    <div className="text-xs text-muted-foreground">
                                                        {emp.shift_start} - {emp.shift_end}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-3 sm:p-4 text-sm">
                                                <div>{emp.work_location || '-'}</div>
                                                {emp.company_name && (
                                                    <div className="text-xs text-muted-foreground">{emp.company_name}</div>
                                                )}
                                            </td>
                                            <td className="p-3 sm:p-4">
                                                <span className={`badge ${emp.profiles?.role === 'admin' ? 'badge-default' : 'badge-secondary'}`}>
                                                    {emp.profiles?.role || 'employee'}
                                                </span>
                                            </td>
                                            <td className="p-3 sm:p-4">
                                                <span className={`badge ${emp.is_active ? 'badge-success' : 'badge-secondary'}`}>
                                                    {emp.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="p-3 sm:p-4">
                                                <div className="flex gap-1">
                                                    <button
                                                        className="btn-ghost btn-sm"
                                                        onClick={(e) => { e.stopPropagation(); openEditModal(emp); }}
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                                                        onClick={(e) => { e.stopPropagation(); openDeleteModal(emp, 'permanent'); }}
                                                        title="Delete"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

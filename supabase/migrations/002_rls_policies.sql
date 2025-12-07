-- Supabase SQL Migration: 002_rls_policies.sql
-- Row Level Security Policies for Employee Management Portal

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE task_instances ENABLE ROW LEVEL SECURITY;

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

ALTER TABLE event_staff_assignments ENABLE ROW LEVEL SECURITY;

ALTER TABLE event_checklists ENABLE ROW LEVEL SECURITY;

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE waivers ENABLE ROW LEVEL SECURITY;

ALTER TABLE staff_notes ENABLE ROW LEVEL SECURITY;

ALTER TABLE policy_strips ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Helper function to check if user is admin
-- =====================================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- Profiles Policies
-- =====================================================
-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON profiles FOR
SELECT USING (auth.uid () = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles" ON profiles FOR
SELECT USING (is_admin ());

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON profiles FOR
UPDATE USING (auth.uid () = id);

-- Admins can update all profiles
CREATE POLICY "Admins can update all profiles" ON profiles FOR
UPDATE USING (is_admin ());

-- Admins can insert profiles
CREATE POLICY "Admins can insert profiles" ON profiles FOR
INSERT
WITH
    CHECK (is_admin ());

-- =====================================================
-- Employees Policies
-- =====================================================
-- Employees can view their own record
CREATE POLICY "Employees can view own record" ON employees FOR
SELECT USING (auth.uid () = id);

-- Admins can view all employees
CREATE POLICY "Admins can view all employees" ON employees FOR
SELECT USING (is_admin ());

-- Admins can insert employees
CREATE POLICY "Admins can insert employees" ON employees FOR
INSERT
WITH
    CHECK (is_admin ());

-- Admins can update all employees
CREATE POLICY "Admins can update employees" ON employees FOR
UPDATE USING (is_admin ());

-- Admins can delete employees
CREATE POLICY "Admins can delete employees" ON employees FOR DELETE USING (is_admin ());

-- =====================================================
-- Attendance Logs Policies
-- =====================================================
-- Employees can view their own attendance
CREATE POLICY "Employees can view own attendance" ON attendance_logs FOR
SELECT USING (auth.uid () = employee_id);

-- Admins can view all attendance
CREATE POLICY "Admins can view all attendance" ON attendance_logs FOR
SELECT USING (is_admin ());

-- Employees can clock in (insert their own record)
CREATE POLICY "Employees can clock in" ON attendance_logs FOR
INSERT
WITH
    CHECK (auth.uid () = employee_id);

-- Employees can clock out (update their own open record)
CREATE POLICY "Employees can clock out" ON attendance_logs FOR
UPDATE USING (
    auth.uid () = employee_id
    AND clock_out IS NULL
);

-- Admins can update any attendance record
CREATE POLICY "Admins can update attendance" ON attendance_logs FOR
UPDATE USING (is_admin ());

-- Admins can delete attendance records
CREATE POLICY "Admins can delete attendance" ON attendance_logs FOR DELETE USING (is_admin ());

-- =====================================================
-- Tasks Policies
-- =====================================================
-- All authenticated users can view tasks
CREATE POLICY "All users can view tasks" ON tasks FOR
SELECT USING (auth.uid () IS NOT NULL);

-- Only admins can create tasks
CREATE POLICY "Admins can create tasks" ON tasks FOR
INSERT
WITH
    CHECK (is_admin ());

-- Only admins can update tasks
CREATE POLICY "Admins can update tasks" ON tasks FOR
UPDATE USING (is_admin ());

-- Only admins can delete tasks
CREATE POLICY "Admins can delete tasks" ON tasks FOR DELETE USING (is_admin ());

-- =====================================================
-- Task Instances Policies
-- =====================================================
-- Employees can view their assigned task instances
CREATE POLICY "Employees can view own task instances" ON task_instances FOR
SELECT USING (auth.uid () = employee_id);

-- Admins can view all task instances
CREATE POLICY "Admins can view all task instances" ON task_instances FOR
SELECT USING (is_admin ());

-- Admins can create task instances
CREATE POLICY "Admins can create task instances" ON task_instances FOR
INSERT
WITH
    CHECK (is_admin ());

-- Employees can update their own task instances
CREATE POLICY "Employees can update own task instances" ON task_instances FOR
UPDATE USING (auth.uid () = employee_id);

-- Admins can update all task instances
CREATE POLICY "Admins can update task instances" ON task_instances FOR
UPDATE USING (is_admin ());

-- Admins can delete task instances
CREATE POLICY "Admins can delete task instances" ON task_instances FOR DELETE USING (is_admin ());

-- =====================================================
-- Events Policies
-- =====================================================
-- All authenticated users can view events
CREATE POLICY "All users can view events" ON events FOR
SELECT USING (auth.uid () IS NOT NULL);

-- Only admins can create events
CREATE POLICY "Admins can create events" ON events FOR
INSERT
WITH
    CHECK (is_admin ());

-- Only admins can update events
CREATE POLICY "Admins can update events" ON events FOR
UPDATE USING (is_admin ());

-- Only admins can delete events
CREATE POLICY "Admins can delete events" ON events FOR DELETE USING (is_admin ());

-- =====================================================
-- Event Staff Assignments Policies
-- =====================================================
-- Employees can see their own assignments
CREATE POLICY "Employees can view own assignments" ON event_staff_assignments FOR
SELECT USING (auth.uid () = employee_id);

-- Admins can view all assignments
CREATE POLICY "Admins can view all assignments" ON event_staff_assignments FOR
SELECT USING (is_admin ());

-- Only admins can manage assignments
CREATE POLICY "Admins can create assignments" ON event_staff_assignments FOR
INSERT
WITH
    CHECK (is_admin ());

CREATE POLICY "Admins can update assignments" ON event_staff_assignments FOR
UPDATE USING (is_admin ());

CREATE POLICY "Admins can delete assignments" ON event_staff_assignments FOR DELETE USING (is_admin ());

-- =====================================================
-- Event Checklists Policies
-- =====================================================
-- Employees can view checklists for events they're assigned to
CREATE POLICY "Employees can view assigned event checklists" ON event_checklists FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM event_staff_assignments
            WHERE
                event_staff_assignments.event_id = event_checklists.event_id
                AND event_staff_assignments.employee_id = auth.uid ()
        )
    );

-- Admins can view all checklists
CREATE POLICY "Admins can view all checklists" ON event_checklists FOR
SELECT USING (is_admin ());

-- Employees can update checklists they complete
CREATE POLICY "Employees can complete checklists" ON event_checklists FOR
UPDATE USING (
    EXISTS (
        SELECT 1
        FROM event_staff_assignments
        WHERE
            event_staff_assignments.event_id = event_checklists.event_id
            AND event_staff_assignments.employee_id = auth.uid ()
    )
);

-- Admins can manage all checklists
CREATE POLICY "Admins can create checklists" ON event_checklists FOR
INSERT
WITH
    CHECK (is_admin ());

CREATE POLICY "Admins can update checklists" ON event_checklists FOR
UPDATE USING (is_admin ());

CREATE POLICY "Admins can delete checklists" ON event_checklists FOR DELETE USING (is_admin ());

-- =====================================================
-- Transactions Policies
-- =====================================================
-- Only admins can directly access transactions table
CREATE POLICY "Admins can view all transactions" ON transactions FOR
SELECT USING (is_admin ());

CREATE POLICY "Admins can create transactions" ON transactions FOR
INSERT
WITH
    CHECK (is_admin ());

-- Note: Employees access transactions through the secure view

-- =====================================================
-- Waivers Policies
-- =====================================================
-- Admins can do everything with waivers
CREATE POLICY "Admins can manage waivers" ON waivers FOR ALL USING (is_admin ());

-- Employees can search and view waivers (read-only)
CREATE POLICY "Employees can view waivers" ON waivers FOR
SELECT USING (auth.uid () IS NOT NULL);

-- =====================================================
-- Staff Notes Policies
-- =====================================================
-- Employees can view their own notes
CREATE POLICY "Employees can view own notes" ON staff_notes FOR
SELECT USING (auth.uid () = employee_id);

-- Admins can view all notes
CREATE POLICY "Admins can view all notes" ON staff_notes FOR
SELECT USING (is_admin ());

-- Employees can create their own notes
CREATE POLICY "Employees can create own notes" ON staff_notes FOR
INSERT
WITH
    CHECK (auth.uid () = employee_id);

-- Employees can update their own notes
CREATE POLICY "Employees can update own notes" ON staff_notes FOR
UPDATE USING (auth.uid () = employee_id);

-- Admins can delete any notes
CREATE POLICY "Admins can delete notes" ON staff_notes FOR DELETE USING (is_admin ());

-- =====================================================
-- Policy Strips Policies
-- =====================================================
-- All authenticated users can view active policy strips
CREATE POLICY "Users can view active policies" ON policy_strips FOR
SELECT USING (
        auth.uid () IS NOT NULL
        AND is_active = TRUE
    );

-- Admins can view all policy strips (including inactive)
CREATE POLICY "Admins can view all policies" ON policy_strips FOR
SELECT USING (is_admin ());

-- Only admins can manage policy strips
CREATE POLICY "Admins can create policies" ON policy_strips FOR
INSERT
WITH
    CHECK (is_admin ());

CREATE POLICY "Admins can update policies" ON policy_strips FOR
UPDATE USING (is_admin ());

CREATE POLICY "Admins can delete policies" ON policy_strips FOR DELETE USING (is_admin ());
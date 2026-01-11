-- =====================================================
-- PlayFunia Employee Management - COMPLETE DATABASE SCHEMA
-- =====================================================
-- Version 2.0 - Final Complete Schema
-- =====================================================
-- FEATURES:
--   1. Employee management with full details (address, DOB, ID docs, shift times)
--   2. Attendance tracking with clock in/out
--   3. Task management with assignments
--   4. Event scheduling with staff assignments
--   5. Schedule system with confirmation workflow & email notifications
--   6. Policy management with media (image/video) support
--   7. Staff notes and transactions
-- =====================================================
-- NOTE: Waiver form functionality has been REMOVED
-- =====================================================
-- RUN THIS IN SUPABASE SQL EDITOR TO SET UP EVERYTHING
-- =====================================================

-- =====================================================
-- PART 0: CLEANUP OLD TABLES
-- =====================================================
DROP FUNCTION IF EXISTS search_waivers_by_phone(TEXT);
DROP TABLE IF EXISTS waivers CASCADE;

-- =====================================================
-- PART 1: EXTENSIONS
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- PART 2: HELPER FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION compute_total_hours()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.clock_out IS NOT NULL AND OLD.clock_out IS NULL THEN
    NEW.total_hours = EXTRACT(EPOCH FROM (NEW.clock_out - NEW.clock_in)) / 3600;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PART 3: TABLES
-- =====================================================

-- -----------------------------------------------------
-- Table: profiles
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------
-- Table: employees
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    display_name TEXT,
    position TEXT,
    shift_type TEXT,
    shift_start TIME,
    shift_end TIME,
    company_name TEXT,
    work_location TEXT,
    date_of_birth DATE,
    phone_number TEXT,
    street_address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    country TEXT DEFAULT 'USA',
    id_document_type TEXT CHECK (id_document_type IS NULL OR id_document_type IN ('drivers_license', 'passport', 'state_id', 'other')),
    id_document_number TEXT,
    id_document_expiry DATE,
    id_document_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    hr_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add columns if they don't exist (for migrations)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'shift_start') THEN
        ALTER TABLE employees ADD COLUMN shift_start TIME;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'shift_end') THEN
        ALTER TABLE employees ADD COLUMN shift_end TIME;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'company_name') THEN
        ALTER TABLE employees ADD COLUMN company_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'work_location') THEN
        ALTER TABLE employees ADD COLUMN work_location TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'date_of_birth') THEN
        ALTER TABLE employees ADD COLUMN date_of_birth DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'phone_number') THEN
        ALTER TABLE employees ADD COLUMN phone_number TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'street_address') THEN
        ALTER TABLE employees ADD COLUMN street_address TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'city') THEN
        ALTER TABLE employees ADD COLUMN city TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'state') THEN
        ALTER TABLE employees ADD COLUMN state TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'zip_code') THEN
        ALTER TABLE employees ADD COLUMN zip_code TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'country') THEN
        ALTER TABLE employees ADD COLUMN country TEXT DEFAULT 'USA';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'id_document_type') THEN
        ALTER TABLE employees ADD COLUMN id_document_type TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'id_document_number') THEN
        ALTER TABLE employees ADD COLUMN id_document_number TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'id_document_expiry') THEN
        ALTER TABLE employees ADD COLUMN id_document_expiry DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'id_document_url') THEN
        ALTER TABLE employees ADD COLUMN id_document_url TEXT;
    END IF;
END $$;

DROP TRIGGER IF EXISTS employees_updated_at ON employees;
CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------
-- Table: attendance_logs
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    clock_in TIMESTAMPTZ NOT NULL,
    clock_out TIMESTAMPTZ,
    total_hours NUMERIC,
    late_flag BOOLEAN NOT NULL DEFAULT FALSE,
    early_checkout_flag BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee_clock_in ON attendance_logs (employee_id, clock_in);

DROP TRIGGER IF EXISTS attendance_logs_updated_at ON attendance_logs;
CREATE TRIGGER attendance_logs_updated_at
  BEFORE UPDATE ON attendance_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS attendance_compute_hours ON attendance_logs;
CREATE TRIGGER attendance_compute_hours
  BEFORE UPDATE ON attendance_logs
  FOR EACH ROW
  EXECUTE FUNCTION compute_total_hours();

-- -----------------------------------------------------
-- Table: tasks
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
    frequency TEXT,
    location TEXT,
    role_target TEXT,
    cutoff_time TIME,
    requires_photo BOOLEAN NOT NULL DEFAULT FALSE,
    requires_video BOOLEAN NOT NULL DEFAULT FALSE,
    requires_notes BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES profiles (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------
-- Table: task_instances
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS task_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    scheduled_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'overdue')),
    completed_at TIMESTAMPTZ,
    notes TEXT,
    photo_url TEXT,
    video_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_instances_employee_date ON task_instances (employee_id, scheduled_date);

DROP TRIGGER IF EXISTS task_instances_updated_at ON task_instances;
CREATE TRIGGER task_instances_updated_at
  BEFORE UPDATE ON task_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------
-- Table: events
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    room TEXT,
    expected_headcount INTEGER,
    notes TEXT,
    created_by UUID REFERENCES profiles (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS events_updated_at ON events;
CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------
-- Table: event_staff_assignments
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS event_staff_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, employee_id)
);

-- -----------------------------------------------------
-- Table: event_checklists
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS event_checklists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    task_title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    completed_by UUID REFERENCES employees (id),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------
-- Table: transactions
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events (id) ON DELETE SET NULL,
    customer_name TEXT,
    phone TEXT,
    amount NUMERIC NOT NULL,
    payment_method TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    handled_by_employee UUID NOT NULL REFERENCES employees (id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_employee_created ON transactions (handled_by_employee, created_at);

-- -----------------------------------------------------
-- Table: staff_notes
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events (id) ON DELETE SET NULL,
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------
-- Table: policy_strips (with media support)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS policy_strips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    image_url TEXT,
    video_url TEXT,
    media_type TEXT DEFAULT 'none' CHECK (media_type IS NULL OR media_type IN ('none', 'image', 'video')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policy_strips' AND column_name = 'image_url') THEN
        ALTER TABLE policy_strips ADD COLUMN image_url TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policy_strips' AND column_name = 'video_url') THEN
        ALTER TABLE policy_strips ADD COLUMN video_url TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policy_strips' AND column_name = 'media_type') THEN
        ALTER TABLE policy_strips ADD COLUMN media_type TEXT DEFAULT 'none';
    END IF;
END $$;

DROP TRIGGER IF EXISTS policy_strips_updated_at ON policy_strips;
CREATE TRIGGER policy_strips_updated_at
  BEFORE UPDATE ON policy_strips
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------
-- Table: schedules (NEW - Flexible scheduling with confirmation)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    schedule_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    title TEXT,
    description TEXT,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancellation_requested', 'cancelled', 'completed')),
    created_by UUID NOT NULL REFERENCES profiles (id),
    confirmed_at TIMESTAMPTZ,
    cancellation_requested_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES profiles (id),
    confirmation_email_sent BOOLEAN DEFAULT FALSE,
    cancellation_email_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_employee_date ON schedules (employee_id, schedule_date);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules (status);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules (schedule_date);

DROP TRIGGER IF EXISTS schedules_updated_at ON schedules;
CREATE TRIGGER schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------
-- Table: schedule_email_logs (NEW)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_email_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id UUID NOT NULL REFERENCES schedules (id) ON DELETE CASCADE,
    email_type TEXT NOT NULL CHECK (email_type IN ('schedule_assigned', 'schedule_confirmed', 'cancellation_requested', 'cancellation_approved', 'schedule_cancelled_by_admin')),
    recipient_email TEXT NOT NULL,
    recipient_type TEXT NOT NULL CHECK (recipient_type IN ('employee', 'manager', 'owner')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedule_email_logs_schedule ON schedule_email_logs (schedule_id);

-- -----------------------------------------------------
-- Table: notification_recipients (NEW)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    recipient_type TEXT NOT NULL CHECK (recipient_type IN ('manager', 'owner')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- PART 4: ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_strips ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_recipients ENABLE ROW LEVEL SECURITY;

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

-- Profiles Policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
CREATE POLICY "Admins can update all profiles" ON profiles FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS "Admins can insert profiles" ON profiles;
CREATE POLICY "Admins can insert profiles" ON profiles FOR INSERT WITH CHECK (is_admin());

-- Employees Policies
DROP POLICY IF EXISTS "Employees can view own record" ON employees;
CREATE POLICY "Employees can view own record" ON employees FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Admins can view all employees" ON employees;
CREATE POLICY "Admins can view all employees" ON employees FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Admins can insert employees" ON employees;
CREATE POLICY "Admins can insert employees" ON employees FOR INSERT WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins can update employees" ON employees;
CREATE POLICY "Admins can update employees" ON employees FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS "Admins can delete employees" ON employees;
CREATE POLICY "Admins can delete employees" ON employees FOR DELETE USING (is_admin());

-- Attendance Logs Policies
DROP POLICY IF EXISTS "Employees can view own attendance" ON attendance_logs;
CREATE POLICY "Employees can view own attendance" ON attendance_logs FOR SELECT USING (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Admins can view all attendance" ON attendance_logs;
CREATE POLICY "Admins can view all attendance" ON attendance_logs FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Employees can clock in" ON attendance_logs;
CREATE POLICY "Employees can clock in" ON attendance_logs FOR INSERT WITH CHECK (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Employees can clock out" ON attendance_logs;
CREATE POLICY "Employees can clock out" ON attendance_logs FOR UPDATE USING (auth.uid() = employee_id AND clock_out IS NULL) WITH CHECK (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Admins can update attendance" ON attendance_logs;
CREATE POLICY "Admins can update attendance" ON attendance_logs FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS "Admins can delete attendance" ON attendance_logs;
CREATE POLICY "Admins can delete attendance" ON attendance_logs FOR DELETE USING (is_admin());

-- Tasks Policies
DROP POLICY IF EXISTS "All users can view tasks" ON tasks;
CREATE POLICY "All users can view tasks" ON tasks FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Admins can create tasks" ON tasks;
CREATE POLICY "Admins can create tasks" ON tasks FOR INSERT WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins can update tasks" ON tasks;
CREATE POLICY "Admins can update tasks" ON tasks FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS "Admins can delete tasks" ON tasks;
CREATE POLICY "Admins can delete tasks" ON tasks FOR DELETE USING (is_admin());

-- Task Instances Policies
DROP POLICY IF EXISTS "Employees can view own task instances" ON task_instances;
CREATE POLICY "Employees can view own task instances" ON task_instances FOR SELECT USING (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Admins can view all task instances" ON task_instances;
CREATE POLICY "Admins can view all task instances" ON task_instances FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Admins can create task instances" ON task_instances;
CREATE POLICY "Admins can create task instances" ON task_instances FOR INSERT WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Employees can update own task instances" ON task_instances;
CREATE POLICY "Employees can update own task instances" ON task_instances FOR UPDATE USING (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Admins can update task instances" ON task_instances;
CREATE POLICY "Admins can update task instances" ON task_instances FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS "Admins can delete task instances" ON task_instances;
CREATE POLICY "Admins can delete task instances" ON task_instances FOR DELETE USING (is_admin());

-- Events Policies
DROP POLICY IF EXISTS "All users can view events" ON events;
CREATE POLICY "All users can view events" ON events FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Admins can create events" ON events;
CREATE POLICY "Admins can create events" ON events FOR INSERT WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins can update events" ON events;
CREATE POLICY "Admins can update events" ON events FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS "Admins can delete events" ON events;
CREATE POLICY "Admins can delete events" ON events FOR DELETE USING (is_admin());

-- Event Staff Assignments Policies
DROP POLICY IF EXISTS "Employees can view own assignments" ON event_staff_assignments;
CREATE POLICY "Employees can view own assignments" ON event_staff_assignments FOR SELECT USING (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Admins can view all assignments" ON event_staff_assignments;
CREATE POLICY "Admins can view all assignments" ON event_staff_assignments FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Admins can create assignments" ON event_staff_assignments;
CREATE POLICY "Admins can create assignments" ON event_staff_assignments FOR INSERT WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins can update assignments" ON event_staff_assignments;
CREATE POLICY "Admins can update assignments" ON event_staff_assignments FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS "Admins can delete assignments" ON event_staff_assignments;
CREATE POLICY "Admins can delete assignments" ON event_staff_assignments FOR DELETE USING (is_admin());

-- Event Checklists Policies
DROP POLICY IF EXISTS "Employees can view assigned event checklists" ON event_checklists;
CREATE POLICY "Employees can view assigned event checklists" ON event_checklists FOR SELECT USING (
    EXISTS (SELECT 1 FROM event_staff_assignments WHERE event_staff_assignments.event_id = event_checklists.event_id AND event_staff_assignments.employee_id = auth.uid())
);
DROP POLICY IF EXISTS "Admins can view all checklists" ON event_checklists;
CREATE POLICY "Admins can view all checklists" ON event_checklists FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Employees can complete checklists" ON event_checklists;
CREATE POLICY "Employees can complete checklists" ON event_checklists FOR UPDATE USING (
    EXISTS (SELECT 1 FROM event_staff_assignments WHERE event_staff_assignments.event_id = event_checklists.event_id AND event_staff_assignments.employee_id = auth.uid())
);
DROP POLICY IF EXISTS "Admins can create checklists" ON event_checklists;
CREATE POLICY "Admins can create checklists" ON event_checklists FOR INSERT WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins can update checklists" ON event_checklists;
CREATE POLICY "Admins can update checklists" ON event_checklists FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS "Admins can delete checklists" ON event_checklists;
CREATE POLICY "Admins can delete checklists" ON event_checklists FOR DELETE USING (is_admin());

-- Transactions Policies
DROP POLICY IF EXISTS "Admins can view all transactions" ON transactions;
CREATE POLICY "Admins can view all transactions" ON transactions FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Admins can create transactions" ON transactions;
CREATE POLICY "Admins can create transactions" ON transactions FOR INSERT WITH CHECK (is_admin());

-- Staff Notes Policies
DROP POLICY IF EXISTS "Employees can view own notes" ON staff_notes;
CREATE POLICY "Employees can view own notes" ON staff_notes FOR SELECT USING (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Admins can view all notes" ON staff_notes;
CREATE POLICY "Admins can view all notes" ON staff_notes FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Employees can create own notes" ON staff_notes;
CREATE POLICY "Employees can create own notes" ON staff_notes FOR INSERT WITH CHECK (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Employees can update own notes" ON staff_notes;
CREATE POLICY "Employees can update own notes" ON staff_notes FOR UPDATE USING (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Admins can delete notes" ON staff_notes;
CREATE POLICY "Admins can delete notes" ON staff_notes FOR DELETE USING (is_admin());

-- Policy Strips Policies
DROP POLICY IF EXISTS "Users can view active policies" ON policy_strips;
CREATE POLICY "Users can view active policies" ON policy_strips FOR SELECT USING (auth.uid() IS NOT NULL AND is_active = TRUE);
DROP POLICY IF EXISTS "Admins can view all policies" ON policy_strips;
CREATE POLICY "Admins can view all policies" ON policy_strips FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Admins can create policies" ON policy_strips;
CREATE POLICY "Admins can create policies" ON policy_strips FOR INSERT WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Admins can update policies" ON policy_strips;
CREATE POLICY "Admins can update policies" ON policy_strips FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS "Admins can delete policies" ON policy_strips;
CREATE POLICY "Admins can delete policies" ON policy_strips FOR DELETE USING (is_admin());

-- Schedules Policies
DROP POLICY IF EXISTS "Employees can view own schedules" ON schedules;
CREATE POLICY "Employees can view own schedules" ON schedules FOR SELECT USING (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Admins can view all schedules" ON schedules;
CREATE POLICY "Admins can view all schedules" ON schedules FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "Admins can create schedules" ON schedules;
CREATE POLICY "Admins can create schedules" ON schedules FOR INSERT WITH CHECK (is_admin());
DROP POLICY IF EXISTS "Employees can update own schedules" ON schedules;
CREATE POLICY "Employees can update own schedules" ON schedules FOR UPDATE USING (auth.uid() = employee_id) WITH CHECK (auth.uid() = employee_id);
DROP POLICY IF EXISTS "Admins can update all schedules" ON schedules;
CREATE POLICY "Admins can update all schedules" ON schedules FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS "Admins can delete schedules" ON schedules;
CREATE POLICY "Admins can delete schedules" ON schedules FOR DELETE USING (is_admin());

-- Schedule Email Logs Policies
DROP POLICY IF EXISTS "Admins can view all email logs" ON schedule_email_logs;
CREATE POLICY "Admins can view all email logs" ON schedule_email_logs FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "System can insert email logs" ON schedule_email_logs;
CREATE POLICY "System can insert email logs" ON schedule_email_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Notification Recipients Policies
DROP POLICY IF EXISTS "Admins can manage notification recipients" ON notification_recipients;
CREATE POLICY "Admins can manage notification recipients" ON notification_recipients FOR ALL USING (is_admin());

-- =====================================================
-- PART 5: DATABASE FUNCTIONS (RPC)
-- =====================================================

CREATE OR REPLACE FUNCTION get_open_attendance()
RETURNS TABLE (id UUID, clock_in TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY
  SELECT al.id, al.clock_in FROM attendance_logs al
  WHERE al.employee_id = auth.uid() AND al.clock_out IS NULL
  ORDER BY al.clock_in DESC LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION clock_in()
RETURNS UUID AS $$
DECLARE new_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM attendance_logs WHERE employee_id = auth.uid() AND clock_out IS NULL) THEN
    RAISE EXCEPTION 'Already clocked in';
  END IF;
  INSERT INTO attendance_logs (employee_id, clock_in) VALUES (auth.uid(), NOW()) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION clock_out()
RETURNS UUID AS $$
DECLARE attendance_id UUID;
BEGIN
  SELECT id INTO attendance_id FROM attendance_logs WHERE employee_id = auth.uid() AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1;
  IF attendance_id IS NULL THEN RAISE EXCEPTION 'Not clocked in'; END IF;
  UPDATE attendance_logs SET clock_out = NOW() WHERE id = attendance_id;
  RETURN attendance_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_today_tasks()
RETURNS TABLE (id UUID, task_id UUID, title TEXT, description TEXT, location TEXT, status TEXT, cutoff_time TIME, requires_photo BOOLEAN, requires_video BOOLEAN, requires_notes BOOLEAN, scheduled_date DATE) AS $$
BEGIN
  RETURN QUERY
  SELECT ti.id, ti.task_id, t.title, t.description, t.location, ti.status, t.cutoff_time, t.requires_photo, t.requires_video, t.requires_notes, ti.scheduled_date
  FROM task_instances ti JOIN tasks t ON t.id = ti.task_id
  WHERE ti.employee_id = auth.uid() AND ti.scheduled_date = CURRENT_DATE
  ORDER BY t.cutoff_time ASC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION complete_task(p_task_instance_id UUID, p_notes TEXT DEFAULT NULL, p_photo_url TEXT DEFAULT NULL, p_video_url TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE task_record RECORD;
BEGIN
  SELECT ti.*, t.requires_photo, t.requires_video, t.requires_notes INTO task_record
  FROM task_instances ti JOIN tasks t ON t.id = ti.task_id WHERE ti.id = p_task_instance_id AND ti.employee_id = auth.uid();
  IF task_record IS NULL THEN RAISE EXCEPTION 'Task not found or not assigned to you'; END IF;
  IF task_record.requires_photo AND p_photo_url IS NULL THEN RAISE EXCEPTION 'Photo is required for this task'; END IF;
  IF task_record.requires_video AND p_video_url IS NULL THEN RAISE EXCEPTION 'Video is required for this task'; END IF;
  IF task_record.requires_notes AND (p_notes IS NULL OR p_notes = '') THEN RAISE EXCEPTION 'Notes are required for this task'; END IF;
  UPDATE task_instances SET status = 'completed', completed_at = NOW(), notes = p_notes, photo_url = p_photo_url, video_url = p_video_url WHERE id = p_task_instance_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_my_upcoming_events(p_limit INTEGER DEFAULT 5)
RETURNS TABLE (id UUID, title TEXT, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, room TEXT, expected_headcount INTEGER, notes TEXT, my_role TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT e.id, e.title, e.start_time, e.end_time, e.room, e.expected_headcount, e.notes, esa.role AS my_role
  FROM events e JOIN event_staff_assignments esa ON esa.event_id = e.id
  WHERE esa.employee_id = auth.uid() AND e.start_time >= NOW()
  ORDER BY e.start_time ASC LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_admin_dashboard_stats();
CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()
RETURNS TABLE (active_employees BIGINT, clocked_in_today BIGINT, tasks_completed_today BIGINT, tasks_pending_today BIGINT, events_today BIGINT, events_this_week BIGINT, schedules_pending_confirmation BIGINT, schedules_cancellation_requested BIGINT) AS $$
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*) FROM employees WHERE is_active = TRUE),
    (SELECT COUNT(*) FROM attendance_logs WHERE DATE(clock_in) = CURRENT_DATE AND clock_out IS NULL),
    (SELECT COUNT(*) FROM task_instances WHERE scheduled_date = CURRENT_DATE AND status = 'completed'),
    (SELECT COUNT(*) FROM task_instances WHERE scheduled_date = CURRENT_DATE AND status = 'pending'),
    (SELECT COUNT(*) FROM events WHERE DATE(start_time) = CURRENT_DATE),
    (SELECT COUNT(*) FROM events WHERE start_time >= CURRENT_DATE AND start_time < CURRENT_DATE + INTERVAL '7 days'),
    (SELECT COUNT(*) FROM schedules WHERE status = 'pending'),
    (SELECT COUNT(*) FROM schedules WHERE status = 'cancellation_requested');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION confirm_schedule(p_schedule_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE schedules SET status = 'confirmed', confirmed_at = NOW()
  WHERE id = p_schedule_id AND employee_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule not found or not in pending status'; END IF;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION request_schedule_cancellation(p_schedule_id UUID, p_reason TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE schedules SET status = 'cancellation_requested', cancellation_requested_at = NOW(), cancellation_reason = p_reason
  WHERE id = p_schedule_id AND employee_id = auth.uid() AND status IN ('pending', 'confirmed');
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule not found or cannot be cancelled'; END IF;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION approve_schedule_cancellation(p_schedule_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Only admins can approve cancellations'; END IF;
  UPDATE schedules SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = auth.uid()
  WHERE id = p_schedule_id AND status = 'cancellation_requested';
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_cancel_schedule(p_schedule_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Only admins can cancel schedules'; END IF;
  UPDATE schedules SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = auth.uid(), cancellation_reason = COALESCE(p_reason, 'Cancelled by admin')
  WHERE id = p_schedule_id AND status IN ('pending', 'confirmed', 'cancellation_requested');
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_my_schedules(p_start_date DATE DEFAULT CURRENT_DATE, p_end_date DATE DEFAULT NULL)
RETURNS TABLE (id UUID, schedule_date DATE, start_time TIME, end_time TIME, title TEXT, description TEXT, location TEXT, status TEXT, confirmed_at TIMESTAMPTZ, cancellation_reason TEXT) AS $$
BEGIN
  RETURN QUERY SELECT s.id, s.schedule_date, s.start_time, s.end_time, s.title, s.description, s.location, s.status, s.confirmed_at, s.cancellation_reason
  FROM schedules s WHERE s.employee_id = auth.uid() AND s.schedule_date >= p_start_date AND (p_end_date IS NULL OR s.schedule_date <= p_end_date)
  ORDER BY s.schedule_date ASC, s.start_time ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_employee_shift_info()
RETURNS TABLE (shift_type TEXT, shift_start TIME, shift_end TIME, company_name TEXT, work_location TEXT) AS $$
BEGIN
  RETURN QUERY SELECT e.shift_type, e.shift_start, e.shift_end, e.company_name, e.work_location FROM employees e WHERE e.id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PART 6: VIEWS
-- =====================================================

CREATE OR REPLACE VIEW employee_recent_transactions AS
SELECT t.id, t.event_id, t.customer_name, t.phone, t.amount, t.payment_method, t.created_at, t.handled_by_employee
FROM transactions t WHERE t.handled_by_employee = auth.uid() ORDER BY t.created_at DESC LIMIT 5;

GRANT SELECT ON employee_recent_transactions TO authenticated;

-- =====================================================
-- PART 7: STORAGE SETUP
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
('task-media', 'task-media', FALSE, 52428800, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
('policy-media', 'policy-media', TRUE, 104857600, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
('employee-docs', 'employee-docs', FALSE, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "Users can upload own task media" ON storage.objects;
CREATE POLICY "Users can upload own task media" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'task-media' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Users can view own task media" ON storage.objects;
CREATE POLICY "Users can view own task media" ON storage.objects FOR SELECT USING (bucket_id = 'task-media' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Admins can view all task media" ON storage.objects;
CREATE POLICY "Admins can view all task media" ON storage.objects FOR SELECT USING (bucket_id = 'task-media' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "Users can delete own task media" ON storage.objects;
CREATE POLICY "Users can delete own task media" ON storage.objects FOR DELETE USING (bucket_id = 'task-media' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Admins can delete task media" ON storage.objects;
CREATE POLICY "Admins can delete task media" ON storage.objects FOR DELETE USING (bucket_id = 'task-media' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Anyone can view policy media" ON storage.objects;
CREATE POLICY "Anyone can view policy media" ON storage.objects FOR SELECT USING (bucket_id = 'policy-media');
DROP POLICY IF EXISTS "Admins can upload policy media" ON storage.objects;
CREATE POLICY "Admins can upload policy media" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'policy-media' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "Admins can delete policy media" ON storage.objects;
CREATE POLICY "Admins can delete policy media" ON storage.objects FOR DELETE USING (bucket_id = 'policy-media' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can upload employee docs" ON storage.objects;
CREATE POLICY "Admins can upload employee docs" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'employee-docs' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "Admins can view employee docs" ON storage.objects;
CREATE POLICY "Admins can view employee docs" ON storage.objects FOR SELECT USING (bucket_id = 'employee-docs' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "Employees can view own docs" ON storage.objects;
CREATE POLICY "Employees can view own docs" ON storage.objects FOR SELECT USING (bucket_id = 'employee-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Admins can delete employee docs" ON storage.objects;
CREATE POLICY "Admins can delete employee docs" ON storage.objects FOR DELETE USING (bucket_id = 'employee-docs' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- =====================================================
-- PART 8: AUTO USER CREATION TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role, status) VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee'), 'active'
  ) ON CONFLICT (id) DO NOTHING;
  INSERT INTO employees (id, display_name, is_active) VALUES (
    NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), TRUE
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Sync existing users
INSERT INTO profiles (id, email, full_name, role, status)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)), COALESCE(u.raw_user_meta_data->>'role', 'employee'), 'active'
FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id) ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, display_name, is_active)
SELECT p.id, COALESCE(p.full_name, split_part(p.email, '@', 1)), TRUE
FROM profiles p WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = p.id) ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- PART 9: TIME CARD ENHANCEMENTS (Added January 2026)
-- =====================================================

-- Add hourly_rate to employees (optional per-employee override)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'hourly_rate') THEN
        ALTER TABLE employees ADD COLUMN hourly_rate NUMERIC(10,2);
    END IF;
END $$;

-- Add location tracking fields to attendance_logs
DO $$
BEGIN
    -- Clock In location fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_in_lat') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_in_lat NUMERIC(10,7);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_in_lng') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_in_lng NUMERIC(10,7);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_in_accuracy') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_in_accuracy NUMERIC(10,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_in_location_status') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_in_location_status TEXT DEFAULT 'unknown';
    END IF;

    -- Clock Out location fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_out_lat') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_out_lat NUMERIC(10,7);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_out_lng') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_out_lng NUMERIC(10,7);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_out_accuracy') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_out_accuracy NUMERIC(10,2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_out_location_status') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_out_location_status TEXT DEFAULT 'unknown';
    END IF;

    -- Break tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'break_minutes') THEN
        ALTER TABLE attendance_logs ADD COLUMN break_minutes INTEGER DEFAULT 0;
    END IF;

    -- Work type (regular, overtime, etc.)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'work_type') THEN
        ALTER TABLE attendance_logs ADD COLUMN work_type TEXT DEFAULT 'regular';
    END IF;

    -- Notes field
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'notes') THEN
        ALTER TABLE attendance_logs ADD COLUMN notes TEXT;
    END IF;
END $$;

-- =====================================================
-- PART 10: DEVICE ID CLOCK-IN FEATURE (Added January 2026)
-- =====================================================
-- Replaces location-based clock-in with device ID verification
-- Employees can only clock in from registered devices

-- Add registered_device_id to employees table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'registered_device_id') THEN
        ALTER TABLE employees ADD COLUMN registered_device_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'device_registered_at') THEN
        ALTER TABLE employees ADD COLUMN device_registered_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'device_name') THEN
        ALTER TABLE employees ADD COLUMN device_name TEXT;
    END IF;
END $$;

-- Add device tracking fields to attendance_logs
DO $$
BEGIN
    -- Clock In device fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_in_device_id') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_in_device_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_in_device_name') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_in_device_name TEXT;
    END IF;

    -- Clock Out device fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_out_device_id') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_out_device_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_logs' AND column_name = 'clock_out_device_name') THEN
        ALTER TABLE attendance_logs ADD COLUMN clock_out_device_name TEXT;
    END IF;
END $$;

-- Function to register a device for an employee
CREATE OR REPLACE FUNCTION register_device(p_device_id TEXT, p_device_name TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE employees
    SET registered_device_id = p_device_id,
        device_registered_at = NOW(),
        device_name = COALESCE(p_device_name, 'Unknown Device')
    WHERE id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found';
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if current device matches registered device
CREATE OR REPLACE FUNCTION check_device(p_device_id TEXT)
RETURNS TABLE (is_registered BOOLEAN, registered_device_id TEXT, device_name TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (e.registered_device_id IS NOT NULL AND e.registered_device_id = p_device_id) AS is_registered,
        e.registered_device_id,
        e.device_name
    FROM employees e
    WHERE e.id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clear registered device (admin only)
CREATE OR REPLACE FUNCTION admin_clear_device(p_employee_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Only admins can clear device registration';
    END IF;

    UPDATE employees
    SET registered_device_id = NULL,
        device_registered_at = NULL,
        device_name = NULL
    WHERE id = p_employee_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PART 11: ADDITIONAL FIXES AND POLICIES
-- =====================================================
-- This section ensures all columns exist and policies are correct
-- Safe to re-run multiple times (idempotent)

-- Ensure employees can update their own device registration fields
DROP POLICY IF EXISTS "Employees can update own device" ON employees;
CREATE POLICY "Employees can update own device" ON employees
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Grant execute on device functions to authenticated users
GRANT EXECUTE ON FUNCTION register_device(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_device(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_clear_device(UUID) TO authenticated;

-- =====================================================
-- SCHEMA COMPLETE
-- =====================================================

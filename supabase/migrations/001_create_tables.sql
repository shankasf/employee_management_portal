-- Supabase SQL Migration: 001_create_tables.sql
-- Employee Management Portal - Complete Database Schema
-- =====================================================
-- DATABASE: playfunia_employee_management
-- This is migration 1 of 4 - Run ALL migrations in the SAME database
-- =====================================================
--
-- IMPORTANT: Database Setup Instructions
-- =====================================================
--
-- Option 1: Create a NEW Supabase Project (Recommended)
--   - Go to https://supabase.com/dashboard
--   - Click "New Project" and create a dedicated project for this app
--   - Run these migrations in the SQL Editor
--
-- Option 2: Use existing Supabase project with separate schema
--   - If you have other projects in the same Supabase instance,
--   - consider using a separate schema to isolate this app's tables:
--
--   CREATE SCHEMA IF NOT EXISTS playfunia;
--   SET search_path TO playfunia, public;
--
--   Then prefix all table names with 'playfunia.' or set search_path
--   NOTE: This requires modifying all table references in the app code
--
-- Option 3: Self-hosted PostgreSQL
--   - Create database: CREATE DATABASE playfunia_employee_management;
--   - Connect to it: \c playfunia_employee_management
--   - Then run these migrations
--
-- =====================================================
-- RUN ORDER: 001 -> 002 -> 003 -> 004 (all in same DB)
-- =====================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- Table: profiles
-- Purpose: One row per authenticated user, used for roles and basic identity
-- =====================================================
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'inactive')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Table: employees
-- Purpose: Extended staff information linked to a profile
-- =====================================================
CREATE TABLE employees (
    id UUID PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    display_name TEXT,
    position TEXT,
    shift_type TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    hr_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Table: attendance_logs
-- Purpose: Track clock-in and clock-out for each employee
-- =====================================================
CREATE TABLE attendance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    clock_in TIMESTAMPTZ NOT NULL,
    clock_out TIMESTAMPTZ,
    total_hours NUMERIC,
    late_flag BOOLEAN NOT NULL DEFAULT FALSE,
    early_checkout_flag BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster queries by employee and date range
CREATE INDEX idx_attendance_logs_employee_clock_in ON attendance_logs (employee_id, clock_in);

CREATE TRIGGER attendance_logs_updated_at
  BEFORE UPDATE ON attendance_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to compute total_hours when clock_out is set
CREATE OR REPLACE FUNCTION compute_total_hours()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.clock_out IS NOT NULL AND OLD.clock_out IS NULL THEN
    NEW.total_hours = EXTRACT(EPOCH FROM (NEW.clock_out - NEW.clock_in)) / 3600;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_compute_hours
  BEFORE UPDATE ON attendance_logs
  FOR EACH ROW
  EXECUTE FUNCTION compute_total_hours();

-- =====================================================
-- Table: tasks
-- Purpose: Define reusable tasks (recurring or one-time)
-- =====================================================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
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

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Table: task_instances
-- Purpose: Specific assignments of a task to an employee on a given date
-- =====================================================
CREATE TABLE task_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    task_id UUID NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    scheduled_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'completed',
            'overdue'
        )
    ),
    completed_at TIMESTAMPTZ,
    notes TEXT,
    photo_url TEXT,
    video_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on employee_id and scheduled_date
CREATE INDEX idx_task_instances_employee_date ON task_instances (employee_id, scheduled_date);

CREATE TRIGGER task_instances_updated_at
  BEFORE UPDATE ON task_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Table: events
-- Purpose: Store parties and events
-- =====================================================
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
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

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Table: event_staff_assignments
-- Purpose: Link employees to events with a specific role
-- =====================================================
CREATE TABLE event_staff_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, employee_id)
);

-- =====================================================
-- Table: event_checklists
-- Purpose: Track post-event checklist items
-- =====================================================
CREATE TABLE event_checklists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    task_title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'completed')
    ),
    completed_by UUID REFERENCES employees (id),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- Table: transactions
-- Purpose: Store minimal transactional information
-- =====================================================
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    event_id UUID REFERENCES events (id) ON DELETE SET NULL,
    customer_name TEXT,
    phone TEXT,
    amount NUMERIC NOT NULL,
    payment_method TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    handled_by_employee UUID NOT NULL REFERENCES employees (id)
);

-- Index on handled_by_employee and created_at
CREATE INDEX idx_transactions_employee_created ON transactions (
    handled_by_employee,
    created_at
);

-- =====================================================
-- Table: waivers
-- Purpose: Store metadata about signed waivers
-- =====================================================
CREATE TABLE waivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    phone TEXT,
    customer_name TEXT,
    signed_at TIMESTAMPTZ,
    waiver_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for phone lookups
CREATE INDEX idx_waivers_phone ON waivers (phone);

-- =====================================================
-- Table: staff_notes
-- Purpose: Store quick notes recorded by staff
-- =====================================================
CREATE TABLE staff_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    event_id UUID REFERENCES events (id) ON DELETE SET NULL,
    employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- Table: policy_strips
-- Purpose: Store short policy and training messages
-- =====================================================
CREATE TABLE policy_strips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER policy_strips_updated_at
  BEFORE UPDATE ON policy_strips
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Function: Handle new user signup
-- Purpose: Auto-create profile when user signs up
-- =====================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee'),
    'active'
  );
  
  -- Also create employee record
  INSERT INTO employees (id, display_name, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    TRUE
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
# PlayFunia Employee Management Portal

A full-stack employee management system for an indoor playground. Built with **Next.js 14 (App Router)**, **React 18**, **TypeScript**, **Tailwind CSS**, and **Supabase** (Postgres, Auth, Storage, RLS).

## What’s inside
- **Admin:** dashboard metrics, employee management, task definitions, event scheduling/staffing, attendance exports, reports, and policy strips.
- **Employee:** personal dashboard with clock in/out, today’s tasks, upcoming events, waiver search, staff notes, and policy reminders.
- **Data layer:** Supabase tables, RLS policies, RPC functions, and a storage bucket for task media.

## Quick start
1) **Install prerequisites**
   - Node.js 18+ and npm
   - Supabase project (free tier works)

2) **Clone and install**
```bash
git clone <your-repo-url>
cd playfunia_employee_management
npm install
```

3) **Environment variables** (copy the example)
```bash
cp .env.local.example .env.local
```
Fill in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` – your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` – anon key (browser-safe)
- `SUPABASE_SERVICE_ROLE_KEY` – service role key (server only; never exposed client-side)

4) **Database setup (Supabase)**
Run the migrations in order from `supabase/migrations/` using the Supabase SQL editor or CLI:
- `001_create_tables.sql` – tables and indexes
- `002_rls_policies.sql` – Row Level Security policies
- `003_views_and_functions.sql` – views + RPC helpers (e.g., `clock_in`, `get_today_tasks`, `get_my_upcoming_events`)
- `004_storage_setup.sql` – `task-media` bucket and policies

5) **Start the app**
```bash
npm run dev        # http://localhost:3000
```
For production:
```bash
npm run build
npm run start
```

## Authentication & roles
- Every logged-in user must have a row in `profiles` linked to `auth.users.id`.
- `role` values: `admin` or `employee`; `status`: `active` or `inactive`.
- First admin: create a profile row for your auth user and set `role='admin'` and `status='active'` directly in the database.

## Key features
**Admin**
- Dashboard cards for active employees, today’s attendance, task completion, upcoming events
- Manage employees (profiles + HR fields)
- Define reusable tasks and requirements (photo/video/notes) and view assignments
- Schedule events, assign staff, and track event checklists
- Attendance logs with filtering/export
- Reports and policy strip management

**Employee**
- Clock in/out with open-attendance detection
- Today’s task list and completion flows (notes/photo/video)
- Upcoming events with assigned roles
- Waiver search by phone and staff notes
- Personal attendance history and active policy strips

## Project structure
```
src/
├─ app/
│  ├─ admin/              # Admin pages (dashboard, employees, tasks, events, attendance, reports, policies)
│  ├─ employee/           # Employee pages (dashboard, tasks, check-in, attendance)
│  ├─ auth/callback/      # Supabase auth callback
│  ├─ login/              # Login page
│  └─ middleware.ts       # Route protection
├─ contexts/AuthContext.tsx   # Auth/session + profile loader
├─ lib/
│  ├─ data/               # Feature-scoped Supabase helpers
│  ├─ supabase/           # Typed and untyped Supabase clients (browser/server)
│  ├─ types/              # Supabase-generated types
│  └─ utils.ts            # Formatting helpers
└─ supabase/migrations/   # SQL migrations
```

## Commands
- `npm run dev`   – start dev server
- `npm run build` – production build
- `npm run start` – serve built app
- `npm run lint`  – lint with Next.js ESLint config

## Data & storage notes
- Task media uses the `task-media` bucket; URLs are stored on `task_instances.photo_url` / `video_url`.
- RLS is the primary security layer—clients call only the data they need; admins can see everything, employees are scoped to themselves.

## License
Private – PlayFunia proprietary software

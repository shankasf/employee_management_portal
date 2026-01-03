# PlayFunia Employee Management Portal

A comprehensive employee management system designed for PlayFunia Indoor Playground. This application helps managers track employee attendance, assign tasks, schedule events, and manage workplace policies - all from a single, easy-to-use web interface.

---

## Table of Contents

1. [What is This Application?](#what-is-this-application)
2. [Key Terms Explained](#key-terms-explained)
3. [Features Overview](#features-overview)
4. [For Administrators](#for-administrators)
5. [For Employees](#for-employees)
6. [Technical Setup](#technical-setup)
7. [Project Structure](#project-structure)
8. [Recent Bug Fixes (January 2026)](#recent-bug-fixes-january-2026)
9. [Commands Reference](#commands-reference)
10. [Troubleshooting](#troubleshooting)
11. [License](#license)

---

## What is This Application?

The PlayFunia Employee Management Portal is a **web-based application** (a website that runs in your browser) that helps manage employees at an indoor playground facility. Think of it as a digital workplace assistant that:

- **Tracks when employees start and end their work day** (like a digital punch clock)
- **Assigns daily tasks** to employees (like a to-do list manager)
- **Schedules events** like birthday parties and assigns staff to work them
- **Shows important company messages** to all employees
- **Generates reports** for management to review attendance and productivity

The application has two main views:
1. **Admin Dashboard** - For managers and administrators to oversee operations
2. **Employee Portal** - For staff members to clock in/out and view their tasks

---

## Key Terms Explained

If you're not familiar with technical terms, here's a simple explanation of words you'll see throughout this documentation:

| Term | Simple Explanation |
|------|-------------------|
| **Web Application** | A program that runs in your internet browser (like Chrome, Safari, or Firefox) instead of being installed on your computer |
| **Dashboard** | The main screen that shows important information at a glance, like a car's dashboard shows speed and fuel |
| **Database** | A digital filing cabinet that stores all the information (employee records, attendance, etc.) |
| **Authentication** | The process of logging in - proving you are who you say you are with email and password |
| **Admin/Administrator** | A manager or supervisor who has full access to control the system |
| **Employee Role** | A regular staff member who can only see their own information |
| **Clock In/Out** | Recording when you start and end your work shift |
| **Task** | A specific job or duty assigned to an employee |
| **Event** | A scheduled activity (like a birthday party) that needs staff assigned |
| **Policy** | A company rule or important message that all employees should know |
| **Schedule** | A plan showing which employees work on which days and times |
| **RLS (Row Level Security)** | A security feature that ensures employees can only see their own data, while admins can see everything |
| **API** | The behind-the-scenes communication system that lets the website talk to the database |
| **Environment Variables** | Secret settings (like passwords) that the application needs to work but shouldn't be shared publicly |

---

## Features Overview

### For Managers (Admin Features)

| Feature | Description |
|---------|-------------|
| **Dashboard Statistics** | See real-time numbers: active employees, who's clocked in, tasks completed, upcoming events |
| **Employee Management** | Add new employees, edit their information, or deactivate accounts |
| **Task Management** | Create task templates and assign them to employees |
| **Event Scheduling** | Create events (birthday parties, etc.) and assign staff members |
| **Attendance Tracking** | View when employees clock in/out, export reports |
| **Schedule Management** | Create work schedules, approve time-off requests |
| **Policy Management** | Post important announcements with optional images or videos |
| **Reports** | Generate reports on attendance, task completion, and more |

### For Staff (Employee Features)

| Feature | Description |
|---------|-------------|
| **Personal Dashboard** | See your tasks, events, and important messages at a glance |
| **Time Clock** | Clock in when you arrive, clock out when you leave |
| **Task List** | View your assigned tasks for the day and mark them complete |
| **My Schedule** | See your upcoming work schedule, confirm or request cancellation |
| **Attendance History** | View your past clock in/out records |
| **Company Policies** | Read important company announcements and policies |

---

## For Administrators

### Admin Dashboard

When you log in as an admin, you'll see:

```
+------------------+------------------+------------------+
|  Active          |  Clocked In      |  Tasks           |
|  Employees: 12   |  Today: 8        |  Completed: 24   |
+------------------+------------------+------------------+
|  Tasks           |  Events          |  Events          |
|  Pending: 6      |  Today: 3        |  This Week: 8    |
+------------------+------------------+------------------+
```

Each card is clickable and takes you to the relevant management page.

### Managing Employees

**To add a new employee:**
1. Go to Admin Dashboard > Employees
2. Click "Add Employee"
3. Fill in the employee's information across four tabs:
   - **Basic Info**: Name, email, position, phone number
   - **Address**: Street address, city, state, zip code
   - **ID Documents**: Driver's license or other ID information
   - **HR**: Emergency contacts, notes, shift preferences

**Important:** When you create an employee, the system automatically:
- Creates a login account for them
- Sets their temporary password to `changeme123`
- The employee should change this password on first login

### Managing Tasks

Tasks are recurring duties that need to be done (like "Clean play area" or "Check safety equipment").

**To create a task:**
1. Go to Admin Dashboard > Tasks
2. Click "Add Task"
3. Enter:
   - Task name (e.g., "Morning Safety Check")
   - Description (detailed instructions)
   - Location (where to do the task)
   - Cutoff time (when it must be done by)
   - Requirements:
     - Does employee need to take a photo?
     - Does employee need to record a video?
     - Does employee need to write notes?

**To assign a task:**
1. Find the task in the list
2. Click "Assign"
3. Select the employee and date

### Managing Events

Events are scheduled activities like birthday parties or special events.

**To create an event:**
1. Go to Admin Dashboard > Events
2. Click "Create Event"
3. Fill in event details:
   - Event name
   - Date and time
   - Room/Location
   - Maximum guests
4. Assign staff members and their roles (Host, Assistant, etc.)

### Managing Schedules

The schedule system allows you to:
- Create single shifts or bulk schedules (multiple days at once)
- Employees can confirm or request to cancel their shifts
- Track schedule status: Pending, Confirmed, Cancellation Requested, Cancelled

**Schedule Statuses Explained:**
| Status | Meaning |
|--------|---------|
| Pending | Schedule created, waiting for employee confirmation |
| Confirmed | Employee has accepted the shift |
| Cancellation Requested | Employee wants to cancel (needs admin approval) |
| Cancelled | Shift has been cancelled |
| Completed | Shift has been worked |

### Managing Policies

Policies are company announcements or rules that all employees can see.

**To create a policy:**
1. Go to Admin Dashboard > Policies
2. Click "Add Policy"
3. Enter:
   - Title (e.g., "New Break Room Rules")
   - Content (the full message)
   - Category (optional, for organization)
   - Optional: Attach an image or video

---

## For Employees

### Your Dashboard

When you log in as an employee, you'll see:

1. **Time Clock** - Big button to clock in or out
2. **Today's Tasks** - List of tasks assigned to you today
3. **My Upcoming Events** - Events you're assigned to work
4. **Important Messages** - Company policies and announcements

### Clocking In and Out

**To clock in:**
1. Log in to your account
2. Click the green "Clock In" button on your dashboard
3. The system records your start time automatically

**To clock out:**
1. When your shift ends, click the red "Clock Out" button
2. The system calculates your total hours worked

**Important:** If you forget to clock out, contact your manager to fix your attendance record.

### Completing Tasks

**To complete a task:**
1. Go to your dashboard or Tasks page
2. Find the task you need to complete
3. Click on the task to open it
4. If required, add:
   - Photo (take or upload a picture)
   - Video (record or upload a video)
   - Notes (write any relevant information)
5. Click "Mark Complete"

### Viewing Your Schedule

**To see your schedule:**
1. Go to Schedules from the menu
2. View your upcoming shifts
3. For each shift, you can:
   - **Confirm** - Accept the shift
   - **Request Cancellation** - Ask to have the shift cancelled (manager must approve)

---

## Technical Setup

This section is for developers or IT staff who need to install and run the application.

### Prerequisites (What You Need First)

Before installing, make sure you have:

1. **Node.js** (version 18 or higher)
   - Node.js is the software that runs the application
   - Download from: https://nodejs.org/

2. **npm** (comes with Node.js)
   - npm is a tool that installs other software the application needs

3. **Supabase Account** (free tier works)
   - Supabase is the database service that stores all the data
   - Sign up at: https://supabase.com/

### Installation Steps

**Step 1: Download the Code**
```bash
git clone <your-repo-url>
cd playfunia_employee_management
```

**Step 2: Install Dependencies**
```bash
npm install
```
This downloads all the additional software packages the application needs.

**Step 3: Set Up Environment Variables**

Copy the example file:
```bash
cp .env.local.example .env.local
```

Open `.env.local` in a text editor and fill in:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Where to find these values:**
1. Go to your Supabase project dashboard
2. Click "Settings" > "API"
3. Copy the "Project URL" and "anon public" key
4. Copy the "service_role" key (keep this secret!)

**Step 4: Set Up the Database**

> **Warning:** Create a NEW Supabase project for this application to avoid conflicts with other databases.

1. Go to your Supabase project
2. Click "SQL Editor"
3. Copy the contents of `supabase/migrations/000_complete_schema.sql`
4. Paste and run in the SQL Editor

This creates all the necessary tables, security rules, and functions.

**Step 5: Create Your First Admin Account**

1. In Supabase, go to "Authentication" > "Users"
2. Click "Add User" and create an account with email/password
3. Go to "Table Editor" > "profiles"
4. Find your new user and set:
   - `role` = `admin`
   - `status` = `active`

**Step 6: Start the Application**

For development (testing):
```bash
npm run dev
```
Open http://localhost:3000 in your browser.

For production (live use):
```bash
npm run build
npm run start
```

---

## Project Structure

Here's how the code is organized:

```
playfunia_employee_management/
│
├── src/                          # All the application code
│   │
│   ├── app/                      # Pages (what users see)
│   │   ├── admin/                # Admin-only pages
│   │   │   ├── page.tsx          # Admin dashboard
│   │   │   ├── employees/        # Employee management
│   │   │   ├── tasks/            # Task management
│   │   │   ├── events/           # Event management
│   │   │   ├── schedules/        # Schedule management
│   │   │   ├── attendance/       # Attendance tracking
│   │   │   ├── reports/          # Reports and analytics
│   │   │   └── policies/         # Policy management
│   │   │
│   │   ├── employee/             # Employee-only pages
│   │   │   ├── page.tsx          # Employee dashboard
│   │   │   ├── tasks/            # Task completion
│   │   │   ├── schedules/        # Schedule viewing
│   │   │   ├── attendance/       # Attendance history
│   │   │   └── checkin/          # Check-in tools
│   │   │
│   │   ├── login/                # Login page
│   │   └── api/                  # Backend API routes
│   │
│   ├── lib/                      # Shared code and utilities
│   │   ├── data/                 # Database operations
│   │   │   ├── users.ts          # Employee/profile functions
│   │   │   ├── tasks.ts          # Task functions
│   │   │   ├── events.ts         # Event functions
│   │   │   ├── schedules.ts      # Schedule functions
│   │   │   ├── attendance.ts     # Attendance functions
│   │   │   └── policies.ts       # Policy functions
│   │   │
│   │   ├── supabase/             # Database connection
│   │   │   ├── client.ts         # Browser-side connection
│   │   │   ├── server.ts         # Server-side connection
│   │   │   └── middleware.ts     # Authentication handling
│   │   │
│   │   ├── hooks/                # Data fetching helpers
│   │   │   └── useData.ts        # All data hooks with caching
│   │   │
│   │   └── utils.ts              # Helper functions (formatting dates, etc.)
│   │
│   ├── contexts/                 # Shared state management
│   │   ├── AuthContext.tsx       # User login state
│   │   └── LogContext.tsx        # Debugging logs
│   │
│   ├── components/               # Reusable UI pieces
│   │   └── LogOverlay.tsx        # Debug overlay
│   │
│   ├── types/                    # TypeScript type definitions
│   │   └── supabase.ts           # Database types
│   │
│   └── middleware.ts             # Route protection
│
├── supabase/                     # Database files
│   └── migrations/
│       └── 000_complete_schema.sql  # Database setup script
│
├── public/                       # Static files (images, etc.)
│
├── package.json                  # Project dependencies
├── .env.local                    # Environment variables (secrets)
├── .env.local.example            # Example environment file
├── Dockerfile                    # Docker container setup
├── docker-compose.yml            # Docker orchestration
└── README.md                     # This file
```

### Key Files Explained

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Home page - redirects users to admin or employee dashboard based on role |
| `src/app/login/page.tsx` | Login form where users enter email and password |
| `src/middleware.ts` | Checks if users are logged in before allowing access to pages |
| `src/contexts/AuthContext.tsx` | Manages the current user's login state throughout the app |
| `src/lib/hooks/useData.ts` | Contains all data fetching functions with automatic caching |
| `src/lib/data/*.ts` | Database operations for each feature (tasks, events, etc.) |

---

## Recent Bug Fixes (January 2026)

The following bugs were identified and fixed in the latest update:

### 1. Date Calculation Bug in Events (events.ts)

**Problem:** The `getTodayEvents()` function was incorrectly calculating today's date range due to JavaScript's `setHours()` method mutating the original Date object.

**What this means:** When the system tried to find "today's events," it might have been looking at the wrong time range, potentially missing events or showing wrong events.

**Fix:** Changed to create separate Date objects for start and end of day:
```javascript
// Before (buggy)
const today = new Date();
const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

// After (fixed)
const now = new Date();
const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
```

### 2. Schedule Statistics Always Showing Zero (schedules.ts)

**Problem:** The `getScheduleStats()` function was returning `null` instead of actual counts because it was reading the wrong property from the database response.

**What this means:** The admin dashboard always showed "0" for pending schedules, cancellation requests, and today's schedules, even when there were actual schedules.

**Fix:** Changed to correctly read the `count` property from Supabase responses:
```javascript
// Before (buggy - data is always null with head: true)
const { data: pending } = await supabase.from("schedules").select("id", { count: "exact", head: true });
return { pending: pending || 0 };  // Always returned 0

// After (fixed)
const { count: pendingCount } = await supabase.from("schedules").select("*", { count: "exact", head: true });
return { pending: pendingCount || 0 };  // Returns actual count
```

### 3. Bulk Schedule Date Issues (admin/schedules/page.tsx)

**Problem:** When creating bulk schedules (multiple schedules at once), dates could be off by one day due to timezone conversion issues with `toISOString()`.

**What this means:** If you created schedules for Monday-Friday, some might have ended up on Sunday or Saturday instead.

**Fix:** Parse and format dates using local date components instead of UTC:
```javascript
// Before (buggy - UTC conversion could change the date)
schedule_date: d.toISOString().split('T')[0]

// After (fixed - uses local date)
const year = currentDate.getFullYear();
const month = String(currentDate.getMonth() + 1).padStart(2, '0');
const day = String(currentDate.getDate()).padStart(2, '0');
schedule_date: `${year}-${month}-${day}`;
```

### 4. Cache Invalidation Not Working (useData.ts)

**Problem:** When data was updated, the cache wasn't properly clearing, causing stale data to be displayed.

**What this means:** After adding a new employee or updating data, the old information might still show until you refreshed the page.

**Fix:** Updated cache invalidation functions to handle both string and array cache keys:
```javascript
// Before (only handled array keys)
employees: () => mutate((key) => Array.isArray(key) && key[0]?.startsWith('admin:employees'));

// After (handles both string and array keys)
employees: () => mutate((key) => {
  if (typeof key === 'string') return key.startsWith('admin:employees');
  if (Array.isArray(key)) return key[0]?.startsWith?.('admin:employees');
  return false;
});
```

### 5. Login Page Build Error

**Problem:** The login page was causing build failures because it used a Next.js feature (`useSearchParams`) without proper wrapping.

**What this means:** The application wouldn't build for production deployment.

**Fix:** Wrapped the login form component in a `Suspense` boundary with a loading fallback.

### 6. Various TypeScript Errors

**Problem:** Several files had type safety issues that could cause unexpected behavior.

**Fixes applied:**
- Added proper type definitions for schedule and notification recipient data
- Fixed unused variable warnings
- Added explicit return types to functions

---

## Commands Reference

| Command | What It Does |
|---------|--------------|
| `npm run dev` | Starts the application in development mode (for testing) |
| `npm run build` | Creates an optimized version for production use |
| `npm run start` | Runs the production version |
| `npm run lint` | Checks code for errors and style issues |

---

## Troubleshooting

### Common Issues and Solutions

**Issue: "Cannot connect to database"**
- Check that your `.env.local` file has the correct Supabase URL and keys
- Make sure your Supabase project is running (not paused)
- Verify you have internet connection

**Issue: "Login doesn't work"**
- Ensure the user exists in Supabase Authentication
- Check that the user has a corresponding row in the `profiles` table
- Verify the user's `status` is set to `active`

**Issue: "Employee can't see their data"**
- Make sure the employee's `profiles.id` matches their `employees.id`
- Check that Row Level Security (RLS) policies are enabled

**Issue: "Schedules showing zero counts"**
- This was fixed in the January 2026 update
- Make sure you have the latest code version

**Issue: "Page shows loading forever"**
- Check browser console for errors (press F12)
- Try clearing your browser cache
- Log out and log back in

**Issue: "Build fails with 'useSearchParams' error"**
- This was fixed in the January 2026 update
- Make sure you have the latest code version

### Getting Help

If you encounter issues not covered here:
1. Check the browser console (F12) for error messages
2. Review the Supabase dashboard for database errors
3. Contact your system administrator

---

## Security Notes

This application implements several security measures:

1. **Authentication Required** - All pages require login
2. **Role-Based Access** - Employees can only see their own data; admins see everything
3. **Row Level Security (RLS)** - Database-level protection ensures data isolation
4. **Secure Passwords** - Passwords are never stored in plain text
5. **Environment Variables** - Sensitive keys are kept out of the code

**Important Security Practices:**
- Never share your `SUPABASE_SERVICE_ROLE_KEY`
- Change the default password (`changeme123`) immediately when creating accounts
- Regularly review admin access and remove unused accounts
- Keep the application updated with the latest security patches

---

## Technology Stack

For technical readers, here's what powers this application:

| Technology | Purpose | Version |
|------------|---------|---------|
| **Next.js** | Web framework (handles pages, routing, server) | 14 |
| **React** | User interface library | 18 |
| **TypeScript** | Programming language (JavaScript with types) | 5 |
| **Tailwind CSS** | Styling (makes it look good) | 3.4 |
| **Supabase** | Database, authentication, storage | Latest |
| **SWR** | Data fetching and caching | 2 |
| **Docker** | Container deployment (optional) | - |

---

## License

Private - PlayFunia Proprietary Software

This software is the property of PlayFunia and is not licensed for external use, distribution, or modification without explicit permission.

---

## Changelog

### Version 2.1 (January 2026)
- Fixed date calculation bug in getTodayEvents
- Fixed schedule statistics returning zero
- Fixed bulk schedule date handling for timezone issues
- Fixed cache invalidation patterns
- Fixed login page build error
- Various TypeScript improvements
- Updated README with comprehensive documentation

### Version 2.0
- Initial release with complete feature set
- Employee management
- Task and event scheduling
- Attendance tracking
- Policy management
- Schedule system with confirmation workflow

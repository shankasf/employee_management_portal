import { createClient } from "@/lib/supabase/client";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Get admin dashboard stats
export async function getAdminDashboardStats() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_admin_dashboard_stats");
  if (error) throw error;
  return data?.[0] ?? null;
}

// New York timezone for all date/time formatting
export const NY_TIMEZONE = 'America/New_York';

// PERFORMANCE: Cache Intl.DateTimeFormat instances at module level
// Creating formatters is expensive; reusing them is ~10x faster
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TIMEZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TIMEZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TIMEZONE,
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const shortWeekdayDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TIMEZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en-US", {
  numeric: "auto",
});

// Format date for display (New York timezone)
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return '-';
  }
  return dateFormatter.format(d);
}

// Format time for display (New York timezone)
export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return '-';
  }
  return timeFormatter.format(d);
}

// Format datetime for display (New York timezone)
export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return '-';
  }
  return dateTimeFormatter.format(d);
}

// Format short date with weekday (e.g., "Mon, Jan 5")
export function formatShortDateWithWeekday(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  return shortWeekdayDateFormatter.format(d);
}

// Format short date (e.g., "Jan 5, 2026")
export function formatShortDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  return shortDateFormatter.format(d);
}

// Format date with weekday for display
export function formatDateWithWeekday(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return '-';
  }
  return weekdayFormatter.format(d);
}

// Format a raw time string "HH:MM" or "HH:MM:SS" to 12-hour AM/PM format
export function formatTimeString(time: string | null | undefined): string {
  if (!time) return '-';
  const parts = time.split(':');
  if (parts.length < 2) return time;
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  if (isNaN(h)) return time;
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

// Format hours (decimal to hours:minutes)
export function formatHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

// Get current date/time formatted in New York timezone
export function getCurrentNYTime(): string {
  return new Date().toLocaleString("en-US", {
    timeZone: NY_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Get today's date in New York timezone as YYYY-MM-DD string
export function getTodayNY(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: NY_TIMEZONE }); // en-CA gives YYYY-MM-DD
}

// Get a date N days from today in New York timezone as YYYY-MM-DD string
export function getDateNY(daysFromToday: number = 0): string {
  if (daysFromToday === 0) return getTodayNY();
  const today = getTodayNY();
  const [y, m, d] = today.split('-').map(Number);
  // Use noon to avoid DST boundary issues during date arithmetic
  const adjusted = new Date(y, m - 1, d + daysFromToday, 12, 0, 0);
  const year = adjusted.getFullYear();
  const month = String(adjusted.getMonth() + 1).padStart(2, '0');
  const day = String(adjusted.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get current month in NY timezone as YYYY-MM string
export function getCurrentMonthNY(): string {
  return getTodayNY().slice(0, 7);
}

// Get the NY timezone UTC offset for a given date string (handles DST)
// Returns offset string like "-05:00" (EST) or "-04:00" (EDT)
export function getNYOffsetStr(dateStr: string): string {
  const dt = new Date(`${dateStr}T12:00:00Z`); // noon UTC to avoid edge cases
  const nyStr = dt.toLocaleString('en-US', { timeZone: NY_TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit' });
  const utcStr = dt.toLocaleString('en-US', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' });
  const [nyH, nyM] = nyStr.split(':').map(Number);
  const [utcH, utcM] = utcStr.split(':').map(Number);
  const diffMinutes = (nyH * 60 + nyM) - (utcH * 60 + utcM);
  const offsetHours = Math.round(diffMinutes / 60);
  return `${offsetHours < 0 ? '-' : '+'}${String(Math.abs(offsetHours)).padStart(2, '0')}:00`;
}

// Get NY day boundary as ISO string (start or end of day in NY timezone)
// Returns UTC ISO string that corresponds to midnight or 23:59:59.999 in NY
export function getNYDayBoundary(dateStr: string, boundary: 'start' | 'end'): string {
  const offset = getNYOffsetStr(dateStr);
  if (boundary === 'start') {
    return new Date(`${dateStr}T00:00:00${offset}`).toISOString();
  }
  return new Date(`${dateStr}T23:59:59.999${offset}`).toISOString();
}

// Get NY month boundaries as ISO strings for database queries
// Returns { start, end } UTC ISO strings for the first and last day of the month in NY
export function getNYMonthBoundaries(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const firstDay = `${yearMonth}-01`;
  const lastDayNum = new Date(year, month, 0).getDate();
  const lastDay = `${yearMonth}-${String(lastDayNum).padStart(2, '0')}`;
  return {
    start: getNYDayBoundary(firstDay, 'start'),
    end: getNYDayBoundary(lastDay, 'end'),
  };
}

// Get current NY datetime components (for form defaults etc.)
// Returns { year, month, day, hours, minutes } in NY timezone
export function getNYDateTimeComponents(date?: Date): { year: string; month: string; day: string; hours: string; minutes: string } {
  const d = date || new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hours: get('hour'),
    minutes: get('minute'),
  };
}

// Format a Date to a datetime-local input string (YYYY-MM-DDTHH:MM) in NY timezone
export function toNYDateTimeString(date: Date): string {
  const { year, month, day, hours, minutes } = getNYDateTimeComponents(date);
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Convert a datetime-local string (representing NY time) to a UTC ISO string for DB storage
// Input: "2026-02-12T15:30" (NY time) → Output: "2026-02-12T20:30:00.000Z" (UTC, during EST)
export function nyDateTimeToUTC(datetimeLocal: string): string {
  const dateStr = datetimeLocal.slice(0, 10); // "YYYY-MM-DD"
  const offset = getNYOffsetStr(dateStr);
  return new Date(`${datetimeLocal}:00${offset}`).toISOString();
}

// Parse a YYYY-MM-DD date string as a local date (not UTC)
// Uses noon to avoid timezone boundary issues
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

// Format a YYYY-MM-DD date string without timezone conversion
// Safe for date-only fields (scheduled_date, date_of_birth, etc.)
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDateOnly(dateStr: string): string {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

// Format a YYYY-MM-DD date string for display with weekday
export function formatScheduleDate(dateStr: string): string {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Use noon to avoid timezone boundary issues when computing weekday
  const date = new Date(year, month - 1, day, 12, 0, 0);
  return `${WEEKDAYS[date.getDay()]}, ${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

// Get relative time (e.g., "2 hours ago", "in 2 hours") using cached formatter
export function getRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  const absDiff = Math.abs(diffInSeconds);
  const sign = diffInSeconds >= 0 ? -1 : 1; // -1 for past, +1 for future

  if (absDiff < 60) return diffInSeconds >= 0 ? "just now" : "in a moment";
  if (absDiff < 3600) {
    const minutes = Math.floor(absDiff / 60);
    return relativeTimeFormatter.format(sign * minutes, "minute");
  }
  if (absDiff < 86400) {
    const hours = Math.floor(absDiff / 3600);
    return relativeTimeFormatter.format(sign * hours, "hour");
  }
  if (absDiff < 604800) {
    const days = Math.floor(absDiff / 86400);
    return relativeTimeFormatter.format(sign * days, "day");
  }
  return formatDate(date);
}

// Calculate completion percentage
export function calculateCompletionRate(
  completed: number,
  total: number
): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

// Get color class based on status
export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
      return "bg-green-100 text-green-800";
    case "pending":
      return "bg-yellow-100 text-yellow-800";
    case "overdue":
      return "bg-red-100 text-red-800";
    case "active":
      return "bg-green-100 text-green-800";
    case "inactive":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// Validate phone number format (requires at least 10 actual digits)
export function isValidPhone(phone: string): boolean {
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length < 10 || digitsOnly.length > 15) return false;
  const phoneRegex = /^[+]?[\d\s()-]+$/;
  return phoneRegex.test(phone);
}

// Sanitize phone for search (remove non-digits)
export function sanitizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// Get public URL for profile pictures (no signing, no expiry)
export function getPublicProfilePicUrl(path: string | null | undefined): string | null {
  if (!path) return null;

  // If it's already a full URL (e.g. from user_metadata), return as-is
  if (path.startsWith('http://') || path.startsWith('https://')) return path;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;

  return `${supabaseUrl}/storage/v1/object/public/profile-pictures/${path}`;
}

// Get signed URL for storage file
// Handles both file paths and existing public URLs
export async function getSignedStorageUrl(
  urlOrPath: string | null | undefined,
  bucket: string = 'task-media'
): Promise<string | null> {
  if (!urlOrPath) return null;

  try {
    const supabase = createClient();
    
    // Extract path from URL if it's a full URL
    // Supabase public URLs format: https://[project].supabase.co/storage/v1/object/public/[bucket]/[path]
    // Or signed URLs: https://[project].supabase.co/storage/v1/object/sign/[bucket]/[path]?...
    let filePath = urlOrPath;
    
    // If it's a full URL, extract the path
    if (urlOrPath.includes('/storage/v1/object/')) {
      const urlParts = urlOrPath.split('/storage/v1/object/');
      if (urlParts.length > 1) {
        // Remove bucket name and query params
        const pathPart = urlParts[1].split('?')[0];
        // Path format: public/[bucket]/[path] or sign/[bucket]/[path]
        const pathAfterType = pathPart.includes('/') ? pathPart.substring(pathPart.indexOf('/') + 1) : pathPart;
        // Remove bucket name if present
        filePath = pathAfterType.startsWith(`${bucket}/`) 
          ? pathAfterType.substring(bucket.length + 1) 
          : pathAfterType;
      }
    }
    
    // Generate signed URL (valid for 1 hour)
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, 3600);

    if (error) {
      console.error('Error creating signed URL:', error);
      return null;
    }

    return data?.signedUrl || null;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    return null;
  }
}

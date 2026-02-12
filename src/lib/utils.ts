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
  const now = new Date();
  const nyDate = new Date(now.toLocaleString("en-US", { timeZone: NY_TIMEZONE }));
  const year = nyDate.getFullYear();
  const month = String(nyDate.getMonth() + 1).padStart(2, '0');
  const day = String(nyDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get a date N days from today in New York timezone as YYYY-MM-DD string
export function getDateNY(daysFromToday: number = 0): string {
  const now = new Date();
  const nyDate = new Date(now.toLocaleString("en-US", { timeZone: NY_TIMEZONE }));
  nyDate.setDate(nyDate.getDate() + daysFromToday);
  const year = nyDate.getFullYear();
  const month = String(nyDate.getMonth() + 1).padStart(2, '0');
  const day = String(nyDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Parse a YYYY-MM-DD date string as a local date (not UTC)
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Format a YYYY-MM-DD date string for display with weekday
export function formatScheduleDate(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: NY_TIMEZONE,
  });
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

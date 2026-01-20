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

// Format hours (decimal to hours:minutes)
export function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
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

// Get relative time (e.g., "2 hours ago") using cached formatter
export function getRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (diffInSeconds < 60) return "just now";
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return relativeTimeFormatter.format(-minutes, "minute");
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return relativeTimeFormatter.format(-hours, "hour");
  }
  if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400);
    return relativeTimeFormatter.format(-days, "day");
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

// Validate phone number format
export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^[+]?[\d\s()-]{10,}$/;
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

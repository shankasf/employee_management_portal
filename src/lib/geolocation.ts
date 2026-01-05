// Geolocation utility for capturing location on clock in/out

export interface LocationData {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  status: 'captured' | 'denied' | 'unavailable' | 'timeout' | 'unknown' | 'prompt';
  timestamp: string;
}

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unavailable';

/**
 * Check if geolocation is supported by the browser
 */
export function isGeolocationSupported(): boolean {
  return typeof window !== 'undefined' && 'geolocation' in navigator;
}

/**
 * Check the current permission status for geolocation
 * Returns: 'granted', 'denied', 'prompt', or 'unavailable'
 */
export async function checkLocationPermission(): Promise<PermissionStatus> {
  if (!isGeolocationSupported()) {
    return 'unavailable';
  }

  // Use Permissions API if available (Chrome, Edge, etc.)
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      return result.state as PermissionStatus;
    } catch {
      // Permissions API not supported for geolocation (Safari, some mobile browsers)
      // We'll return 'prompt' to trigger the actual request
      return 'prompt';
    }
  }

  // Fallback for browsers without Permissions API
  return 'prompt';
}

/**
 * Request location permission by triggering a geolocation request
 * This will show the browser's permission prompt
 */
export async function requestLocationPermission(): Promise<PermissionStatus> {
  if (!isGeolocationSupported()) {
    return 'unavailable';
  }

  return new Promise((resolve) => {
    // Force a fresh location request to trigger the browser's permission prompt
    navigator.geolocation.getCurrentPosition(
      () => {
        // Permission granted and location obtained
        resolve('granted');
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          resolve('denied');
        } else {
          // Other errors (timeout, position unavailable)
          // The permission might have been granted but location failed
          // Try to check permission status directly
          if (navigator.permissions && navigator.permissions.query) {
            navigator.permissions.query({ name: 'geolocation' })
              .then(result => resolve(result.state as PermissionStatus))
              .catch(() => resolve('prompt'));
          } else {
            resolve('prompt');
          }
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 30000, // Give user time to respond to prompt
        maximumAge: 0,  // Force fresh request to trigger permission prompt
      }
    );
  });
}

/**
 * Capture the current location with high accuracy
 */
export async function captureLocation(timeoutMs: number = 15000): Promise<LocationData> {
  const timestamp = new Date().toISOString();

  // Check if geolocation is available
  if (!isGeolocationSupported()) {
    return {
      lat: null,
      lng: null,
      accuracy: null,
      status: 'unavailable',
      timestamp,
    };
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve({
        lat: null,
        lng: null,
        accuracy: null,
        status: 'timeout',
        timestamp,
      });
    }, timeoutMs);

    // First try with high accuracy
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timeoutId);
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          status: 'captured',
          timestamp,
        });
      },
      (error) => {
        // If high accuracy fails, try with low accuracy
        if (error.code !== error.PERMISSION_DENIED) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              clearTimeout(timeoutId);
              resolve({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                status: 'captured',
                timestamp,
              });
            },
            (fallbackError) => {
              clearTimeout(timeoutId);
              resolve({
                lat: null,
                lng: null,
                accuracy: null,
                status: getErrorStatus(fallbackError),
                timestamp,
              });
            },
            {
              enableHighAccuracy: false,
              timeout: 10000,
              maximumAge: 60000, // Accept position up to 1 minute old
            }
          );
        } else {
          clearTimeout(timeoutId);
          resolve({
            lat: null,
            lng: null,
            accuracy: null,
            status: 'denied',
            timestamp,
          });
        }
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs - 5000, // Leave time for fallback
        maximumAge: 0,
      }
    );
  });
}

/**
 * Helper to convert GeolocationPositionError to status string
 */
function getErrorStatus(error: GeolocationPositionError): LocationData['status'] {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'denied';
    case error.POSITION_UNAVAILABLE:
      return 'unavailable';
    case error.TIMEOUT:
      return 'timeout';
    default:
      return 'unknown';
  }
}

/**
 * Format location status for display
 */
export function formatLocationStatus(status: string | null): { text: string; color: string; icon: string } {
  switch (status) {
    case 'captured':
      return { text: 'GPS', color: 'text-green-600', icon: '📍' };
    case 'denied':
      return { text: 'Location Denied', color: 'text-red-600', icon: '🚫' };
    case 'unavailable':
      return { text: 'Location Unavailable', color: 'text-yellow-600', icon: '⚠️' };
    case 'timeout':
      return { text: 'Location Timeout', color: 'text-orange-600', icon: '⏱️' };
    case 'prompt':
      return { text: 'Permission Required', color: 'text-blue-600', icon: '📍' };
    default:
      return { text: 'Unknown', color: 'text-gray-500', icon: '❓' };
  }
}

/**
 * Detect browser type from user agent
 */
export function detectBrowser(): 'chrome' | 'firefox' | 'safari' | 'edge' | 'ios-safari' | 'android-chrome' | 'samsung' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown';

  const ua = navigator.userAgent;

  // Check mobile first
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);

  // iOS Safari (not Chrome/Firefox on iOS)
  if (isIOS) {
    if (/CriOS/.test(ua)) return 'chrome'; // Chrome on iOS
    if (/FxiOS/.test(ua)) return 'firefox'; // Firefox on iOS
    return 'ios-safari';
  }

  // Android browsers
  if (isAndroid) {
    if (/SamsungBrowser/.test(ua)) return 'samsung';
    if (/Chrome/.test(ua)) return 'android-chrome';
    if (/Firefox/.test(ua)) return 'firefox';
    return 'android-chrome'; // Default to Chrome behavior
  }

  // Desktop browsers - order matters!
  if (/Edg/.test(ua)) return 'edge'; // Edge (Chromium)
  if (/Firefox/.test(ua)) return 'firefox';
  if (/Chrome/.test(ua)) return 'chrome'; // Chrome includes "Safari" in UA
  if (/Safari/.test(ua)) return 'safari'; // True Safari (no "Chrome" in UA)

  return 'unknown';
}

/**
 * Get user-friendly instructions for enabling location
 */
export function getLocationInstructions(): string {
  const browser = detectBrowser();

  switch (browser) {
    case 'ios-safari':
      return 'Tap "Allow" when prompted, or go to Settings > Safari > Location > Allow';
    case 'android-chrome':
      return 'Tap "Allow" when prompted, or tap the lock icon > Site settings > Location > Allow';
    case 'samsung':
      return 'Tap "Allow" when prompted, or go to Settings > Site permissions > Location';
    case 'chrome':
      return 'Click "Allow" when prompted, or click the lock/tune icon in address bar > Site settings > Location > Allow';
    case 'firefox':
      return 'Click "Allow" when prompted, or click the lock icon > Connection secure > More information > Permissions > Access your location > Allow';
    case 'safari':
      return 'Click "Allow" when prompted, or go to Safari > Settings > Websites > Location > Allow';
    case 'edge':
      return 'Click "Allow" when prompted, or click the lock icon > Site permissions > Location > Allow';
    default:
      return 'Click "Allow" when your browser asks for location permission';
  }
}

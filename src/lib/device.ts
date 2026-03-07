// Device detection utility for clock-in verification
// Detects device model name and combines with userId for a stable, unique device ID

const DEVICE_NAME_KEY = 'playfunia_device_name';
const DEVICE_SEEN_KEY = 'playfunia_device_seen';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  isNew: boolean; // true if this is the first time we're seeing this device
}

/**
 * Detect the device model name.
 *
 * - Android (Chrome/Edge/Samsung Internet): Uses Client Hints API for actual hardware model
 * - Android (older browsers): Parses UA string, skipping Chrome UA-reduction placeholder "K"
 * - iOS: Maps screen dimensions + DPR to a readable string (Apple hides the model)
 * - Desktop: Detects from UA string
 */
async function detectDeviceModel(): Promise<string> {
  if (typeof navigator === 'undefined') {
    return 'Unknown Device';
  }

  const ua = navigator.userAgent;

  // --- Android: try Client Hints API first (returns real hardware model) ---
  if (/Android/.test(ua)) {
    // navigator.userAgentData is available on Chromium-based browsers
    const uaData = (navigator as NavigatorWithUAData).userAgentData;
    if (uaData?.getHighEntropyValues) {
      try {
        const hints = await uaData.getHighEntropyValues(['model']);
        if (hints.model && hints.model !== '' && hints.model !== 'K') {
          return hints.model;
        }
      } catch {
        // getHighEntropyValues can throw — fall through to UA parsing
      }
    }

    // Fallback: parse UA string for older Android browsers
    const match = ua.match(/Android.*?;\s*([^;)]+)/);
    if (match && match[1]) {
      const model = match[1].trim().replace(/Build\/.*/, '').trim();
      // Chrome UA reduction uses "K" as a placeholder — skip it
      if (model && model !== 'K') {
        return model;
      }
    }

    return 'Android Device';
  }

  // --- iOS: screen dimensions + DPR (Apple hides the model in UA) ---
  if (/iPhone/.test(ua)) {
    const w = screen.width;
    const h = screen.height;
    const dpr = window.devicePixelRatio || 1;
    return `iPhone (${w}x${h}@${dpr}x)`;
  }
  if (/iPad/.test(ua)) {
    const w = screen.width;
    const h = screen.height;
    const dpr = window.devicePixelRatio || 1;
    return `iPad (${w}x${h}@${dpr}x)`;
  }

  // --- Desktop ---
  if (/CrOS/.test(ua)) {
    return 'Chromebook';
  }
  if (/Windows/.test(ua)) {
    return 'Windows PC';
  }
  if (/Macintosh/.test(ua)) {
    return 'Mac';
  }
  if (/Linux/.test(ua)) {
    return 'Linux PC';
  }

  return 'Unknown Device';
}

/**
 * Type for navigator.userAgentData (Client Hints API — not in all TS libs yet)
 */
interface NavigatorWithUAData extends Navigator {
  userAgentData?: {
    getHighEntropyValues(hints: string[]): Promise<{ model?: string }>;
  };
}

/**
 * Simple hash function (djb2)
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  // Convert to hex and make it look like a device ID
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `DEV-${hex.toUpperCase()}`;
}

/**
 * Generate a device fingerprint from the model name + userId.
 * Two employees with the same phone model get different IDs.
 * Same employee, different browser on same phone → same ID.
 */
function generateDeviceFingerprint(deviceModel: string, userId: string): string {
  return hashString(deviceModel + userId);
}

/**
 * Get device info with a deterministic device ID.
 * The ID is computed from the device model + userId, so it stays stable
 * across browsers on the same physical device for the same employee.
 */
export async function getDeviceInfo(userId: string): Promise<DeviceInfo> {
  if (typeof window === 'undefined') {
    return {
      deviceId: 'server-side',
      deviceName: 'Server',
      isNew: false,
    };
  }

  // Detect the device model (async for Client Hints API)
  const deviceModel = await detectDeviceModel();
  const deviceId = generateDeviceFingerprint(deviceModel, userId);

  // Cache device name in localStorage for display purposes
  let deviceName = localStorage.getItem(DEVICE_NAME_KEY);
  if (!deviceName || deviceName !== deviceModel) {
    deviceName = deviceModel;
    localStorage.setItem(DEVICE_NAME_KEY, deviceName);
  }

  // Track whether we've seen this device before (for registration prompt UX)
  const seen = localStorage.getItem(DEVICE_SEEN_KEY);
  const isNew = seen !== deviceId;
  if (isNew) {
    localStorage.setItem(DEVICE_SEEN_KEY, deviceId);
  }

  return {
    deviceId,
    deviceName,
    isNew,
  };
}

/**
 * Get just the device ID (for quick checks)
 */
export async function getDeviceId(userId: string): Promise<string> {
  const info = await getDeviceInfo(userId);
  return info.deviceId;
}

/**
 * Check if this device ID matches the registered device ID
 */
export async function isDeviceRegistered(registeredDeviceId: string | null, userId: string): Promise<boolean> {
  if (!registeredDeviceId) {
    return false;
  }
  const currentDeviceId = await getDeviceId(userId);
  return currentDeviceId === registeredDeviceId;
}

/**
 * Clear stored device info (for testing/debugging)
 */
export function clearDeviceInfo(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(DEVICE_NAME_KEY);
    localStorage.removeItem(DEVICE_SEEN_KEY);
  }
}

/**
 * Format device info for display
 */
export function formatDeviceDisplay(deviceName: string | null, deviceId: string | null): string {
  if (!deviceId) {
    return 'No device registered';
  }
  const name = deviceName || 'Unknown Device';
  // Show last 8 chars of device ID
  const shortId = deviceId.slice(-8);
  return `${name} (${shortId})`;
}

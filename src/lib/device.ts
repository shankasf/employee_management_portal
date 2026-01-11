// Device fingerprinting utility for clock-in verification
// Generates a unique device ID that persists in localStorage

const DEVICE_ID_KEY = 'playfunia_device_id';
const DEVICE_NAME_KEY = 'playfunia_device_name';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  isNew: boolean; // true if this is the first time we're seeing this device
}

/**
 * Generate a unique device fingerprint based on browser characteristics
 * This creates a hash of stable browser properties
 */
function generateDeviceFingerprint(): string {
  if (typeof window === 'undefined') {
    return 'server-side';
  }

  const components: string[] = [];

  // Screen properties
  components.push(`screen:${screen.width}x${screen.height}x${screen.colorDepth}`);

  // Timezone
  components.push(`tz:${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

  // Language
  components.push(`lang:${navigator.language}`);

  // Platform
  components.push(`platform:${navigator.platform}`);

  // Hardware concurrency (number of CPU cores)
  if (navigator.hardwareConcurrency) {
    components.push(`cores:${navigator.hardwareConcurrency}`);
  }

  // Device memory (if available)
  if ('deviceMemory' in navigator) {
    components.push(`mem:${(navigator as Navigator & { deviceMemory?: number }).deviceMemory}`);
  }

  // Touch support
  components.push(`touch:${navigator.maxTouchPoints || 0}`);

  // User agent (partial - just browser info)
  const ua = navigator.userAgent;
  const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/[\d.]+/);
  if (browserMatch) {
    components.push(`browser:${browserMatch[0]}`);
  }

  // Create a hash from all components
  const fingerprint = components.join('|');
  return hashString(fingerprint);
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
  // Add a random component to make it more unique per browser instance
  return `DEV-${hex.toUpperCase()}`;
}

/**
 * Generate a random suffix to make the device ID unique even for similar browsers
 */
function generateRandomSuffix(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Detect device name from user agent
 */
function detectDeviceName(): string {
  if (typeof navigator === 'undefined') {
    return 'Unknown Device';
  }

  const ua = navigator.userAgent;

  // Check for mobile devices first
  if (/iPhone/.test(ua)) {
    return 'iPhone';
  }
  if (/iPad/.test(ua)) {
    return 'iPad';
  }
  if (/Android/.test(ua)) {
    // Try to get device model
    const match = ua.match(/Android.*?;\s*([^;)]+)/);
    if (match && match[1]) {
      const model = match[1].trim();
      // Clean up common suffixes
      return model.replace(/Build\/.*/, '').trim() || 'Android Device';
    }
    return 'Android Device';
  }

  // Desktop browsers
  if (/Windows/.test(ua)) {
    return 'Windows PC';
  }
  if (/Macintosh/.test(ua)) {
    return 'Mac';
  }
  if (/Linux/.test(ua)) {
    return 'Linux PC';
  }
  if (/CrOS/.test(ua)) {
    return 'Chromebook';
  }

  return 'Unknown Device';
}

/**
 * Get or create a device ID
 * The device ID is stored in localStorage and persists across sessions
 */
export function getDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined') {
    return {
      deviceId: 'server-side',
      deviceName: 'Server',
      isNew: false,
    };
  }

  // Try to get existing device ID
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  let deviceName = localStorage.getItem(DEVICE_NAME_KEY);
  let isNew = false;

  if (!deviceId) {
    // Generate new device ID
    const fingerprint = generateDeviceFingerprint();
    const suffix = generateRandomSuffix();
    deviceId = `${fingerprint}-${suffix}`;
    deviceName = detectDeviceName();

    // Store in localStorage
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    localStorage.setItem(DEVICE_NAME_KEY, deviceName);
    isNew = true;
  }

  if (!deviceName) {
    deviceName = detectDeviceName();
    localStorage.setItem(DEVICE_NAME_KEY, deviceName);
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
export function getDeviceId(): string {
  return getDeviceInfo().deviceId;
}

/**
 * Get the device name
 */
export function getDeviceName(): string {
  return getDeviceInfo().deviceName;
}

/**
 * Clear stored device info (for testing/debugging)
 */
export function clearDeviceInfo(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(DEVICE_NAME_KEY);
  }
}

/**
 * Check if this device ID matches the registered device ID
 */
export function isDeviceRegistered(registeredDeviceId: string | null): boolean {
  if (!registeredDeviceId) {
    return false;
  }
  const currentDeviceId = getDeviceId();
  return currentDeviceId === registeredDeviceId;
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

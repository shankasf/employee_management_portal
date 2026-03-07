-- Reset all device registrations so employees re-register with the new
-- model-based device fingerprint (replaces old unstable fingerprint).
UPDATE employees
SET registered_device_id = NULL,
    device_name = NULL,
    device_registered_at = NULL
WHERE registered_device_id IS NOT NULL;

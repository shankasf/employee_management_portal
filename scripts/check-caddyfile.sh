#!/bin/bash
# Caddyfile Domain Validator
# Checks that all required domains are present in the Caddyfile
# Logs to syslog and sends email alert if domains are missing

CADDYFILE="/home/ubuntu/apps/playfunia_employee_management/Caddyfile"
REQUIRED_DOMAINS=("playfunia.com" "www.playfunia.com" "admin.playfunia.com")

ALERT_EMAIL="sagarshankaranusa@gmail.com"

missing=()
for domain in "${REQUIRED_DOMAINS[@]}"; do
    if ! grep -q "^${domain}\s*{" "$CADDYFILE" 2>/dev/null; then
        missing+=("$domain")
    fi
done

if [ ${#missing[@]} -gt 0 ]; then
    msg="CRITICAL: Caddyfile missing domains: ${missing[*]}"
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    # Log to syslog and stdout
    echo "[$timestamp] $msg"
    logger -t caddyfile-check -p user.err "$msg"

    # Send email alert via sendmail/AWS SES
    if command -v sendmail &> /dev/null; then
        sendmail -t <<EOF
To: $ALERT_EMAIL
From: monitoring@playfunia.com
Subject: [ALERT] Caddyfile Configuration Error

$msg

Detected at: $timestamp
Server: $(hostname)

Action required: Check /home/ubuntu/apps/playfunia_employee_management/Caddyfile

To restore from git:
  cd /home/ubuntu/apps/playfunia_employee_management
  git checkout HEAD -- Caddyfile
  docker restart playfunia-caddy
EOF
    fi

    exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] OK: All required domains present in Caddyfile"
exit 0

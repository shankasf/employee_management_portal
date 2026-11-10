# Calendar Integration — Setup Checklist

Everything in the app is built and deployed. Three things must be configured
before employees can actually connect an account.

---

## 1. Encryption key — DONE

`CALENDAR_TOKEN_ENC_KEY` has been generated and added to `.env.local`.

OAuth refresh tokens are encrypted with AES-256-GCM before they touch the
database. **If this key is rotated, every existing connection breaks** and each
user must reconnect. Back it up alongside your other secrets.

---

## 2. Google Calendar — you need to create the OAuth app

Google Cloud Console → your project (or a new one):

1. **Enable the API**: APIs & Services → Library → *Google Calendar API* → Enable.
2. **OAuth consent screen**:
   - User type: **External** (unless every employee is on a Google Workspace
     domain you own — then Internal, which skips verification entirely).
   - Fill in app name, support email, logo, and the privacy-policy /
     terms-of-service URLs. Google will not verify without them.
   - Add the scope `https://www.googleapis.com/auth/calendar`.
3. **Credentials** → Create Credentials → OAuth client ID → **Web application**.
   - Authorised redirect URI — must match exactly:
     ```
     https://admin.playfunia.com/api/calendar/callback/google
     ```
4. Put the client id and secret in `.env.local`:
   ```
   GOOGLE_CALENDAR_CLIENT_ID=...
   GOOGLE_CALENDAR_CLIENT_SECRET=...
   ```
   If these are unset the code falls back to the existing
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — but only reuse
   those if that client is a Web application type with the redirect URI above.

### The verification cap — read this

`auth/calendar` is a **sensitive scope**. Until Google verifies the app:

- users see an "app isn't verified" interstitial (they can click through via
  *Advanced → Go to …*), and
- there is a hard cap of **100 users for the lifetime of the project**. It
  cannot be reset.

Under ~100 staff, you can run unverified indefinitely. Above that, submit for
verification (typically weeks; restricted-scope apps can also need a CASA
security assessment). Employees who prefer not to click through the warning can
use the Apple/ICS subscription link instead — it needs no Google app at all.

---

## 3. Microsoft / Outlook — optional

Azure Portal → Microsoft Entra ID → App registrations → New registration:

1. Supported account types: *Accounts in any organizational directory and
   personal Microsoft accounts*.
2. Redirect URI (Web):
   ```
   https://admin.playfunia.com/api/calendar/callback/microsoft
   ```
3. API permissions → Microsoft Graph → Delegated → `Calendars.ReadWrite`,
   `offline_access`, `openid`, `profile`, `email`.
4. Certificates & secrets → New client secret.
5. Add to `.env.local`:
   ```
   MICROSOFT_CLIENT_ID=...
   MICROSOFT_CLIENT_SECRET=...
   MICROSOFT_TENANT_ID=common
   ```

Until these are set, the Outlook row on the Settings page shows
"Not configured yet" and cannot be clicked. Nothing else is affected.

---

## 4. Cron job — recommended

Push notifications are the fast path, but Google does not guarantee a
notification for every change and channels expire within about a week. The
reconcile job renews channels and re-syncs everyone.

Add to the system crontab (same place as the existing PlayFunia crons):

```cron
0 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://admin.playfunia.com/api/cron/calendar-sync >> /var/log/playfunia-calendar-sync.log 2>&1
```

Hourly is a sensible default. It uses the existing `CRON_SECRET`.

---

## What each piece gives you

| Path | Direction | Latency | Needs an OAuth app? |
|---|---|---|---|
| Google OAuth | Two-way | Seconds (push channel) | Yes |
| Outlook OAuth | Two-way | Seconds (Graph subscription) | Yes |
| ICS subscription (Apple etc.) | One-way, out | Hours — client controls polling | No |
| One-time `.ics` download | Snapshot | n/a | No |

Apple has no public calendar API and no OAuth for calendars, so the
subscription link is the only one-tap option there. This matches what Deputy,
7shifts and When I Work all ship.

---

## Debugging — reading the logs

Every calendar log line is prefixed `[CALENDAR:<area>]` and goes to PM2.

```bash
# everything calendar-related, live
pm2 logs playfunia-employee | grep CALENDAR

# just one area
pm2 logs playfunia-employee | grep 'CALENDAR:oauth'    # connect / disconnect
pm2 logs playfunia-employee | grep 'CALENDAR:push'     # our events -> their calendar
pm2 logs playfunia-employee | grep 'CALENDAR:pull'     # their calendar -> us
pm2 logs playfunia-employee | grep 'CALENDAR:token'    # refresh / re-auth
pm2 logs playfunia-employee | grep 'CALENDAR:watch'    # push channel lifecycle
pm2 logs playfunia-employee | grep 'CALENDAR:webhook'  # incoming notifications
pm2 logs playfunia-employee | grep 'CALENDAR:edits'    # employee edits -> change requests
pm2 logs playfunia-employee | grep 'CALENDAR:feed'     # ICS subscription + downloads
pm2 logs playfunia-employee | grep 'CALENDAR:cron'     # hourly reconcile
pm2 logs playfunia-employee | grep 'CALENDAR:api'      # raw Google / Graph HTTP calls

# only problems
pm2 logs playfunia-employee | grep -E 'CALENDAR.*\[(ERROR|WARN)\]'

# one employee (log lines carry the first 8 chars of the user id)
pm2 logs playfunia-employee | grep CALENDAR | grep 'user:80f6b0dd'
```

**Verbose mode.** Per-item and per-HTTP-call tracing is at DEBUG level, which is
suppressed in production by default. To turn it on temporarily:

```bash
# add DEBUG_LOGS=true to .env.local, then
pm2 restart playfunia-employee --update-env
```

Turn it back off afterwards — it logs one line per API call.

**Areas map to failure modes:**

| Symptom | Grep for | Look for |
|---|---|---|
| "Connect" does nothing | `CALENDAR:oauth` | "not configured", "Security check failed" |
| Shifts stopped updating | `CALENDAR:token` | "Token refresh failed" → user must reconnect |
| Updates are slow, not instant | `CALENDAR:watch` | channel never opened / expired |
| Events missing in their calendar | `CALENDAR:push` | per-item "Failed to push one item" |
| Personal events not showing | `CALENDAR:pull` | 401/403, or sharing pref is off |
| Google/Graph rejecting us | `CALENDAR:api` | status, `googleMessage` / `graphMessage` |
| Unexpected cancellation requests | `CALENDAR:edits` | which event was deleted/moved and by whom |

Tokens, secrets and sync tokens are **never** written to logs — only lengths and
presence flags. Query strings are stripped from logged API paths for that reason.

Connection-level errors are also persisted to
`calendar_connections.last_error` and surfaced in the UI on the Settings page,
so an employee can usually self-diagnose ("Reconnect needed").

---

## Behaviour notes

- We create a **separate calendar named "PlayFunia"** in the connected account
  rather than writing into the personal calendar. Disconnecting deletes it.
- **Employee edits do not rewrite shifts.** Deleting a synced shift event in
  Google/Outlook files a `cancellation_requested` on the schedule — the same
  flow as the in-app button — and moving it files a reschedule request. Both
  land in `calendar_change_requests` for an admin to resolve.
- **Personal events are private by default.** An admin sees them on the
  Employee Calendar page only if the employee turns on "Show when I am busy",
  and sees only anonymous *Busy* blocks unless they also turn on
  "Also show event titles and details".
- Sync window is 30 days back / 180 days forward.

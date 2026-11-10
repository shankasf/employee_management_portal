/**
 * Shared helpers for the weekly schedule calendar view:
 *  - deterministic per-employee colors (consistent across renders/pages)
 *  - export to CSV / PDF (print) / PNG (html2canvas)
 */

import { formatScheduleDate, formatTimeString } from '@/lib/utils'

export interface EmployeeColor {
  bg: string      // light background (hex)
  border: string  // border / accent (hex)
  text: string    // readable text on bg (hex)
}

// Build a coherent {bg, border, text} trio from a single hue so every color is
// readable (light bg, mid border, dark text) regardless of which hue we land on.
function hueColor(hue: number): EmployeeColor {
  const h = ((hue % 360) + 360) % 360
  return {
    bg: `hsl(${h}, 70%, 90%)`,
    border: `hsl(${h}, 60%, 45%)`,
    text: `hsl(${h}, 65%, 27%)`,
  }
}

// Golden angle — successive multiples spread hues as far apart as possible, so
// even dozens of employees get visually distinct, evenly-distributed colors.
const GOLDEN_ANGLE = 137.508

// Stable string hash (djb2). Fallback color when no ordered key set is given
// (e.g. a single-employee view); maps an id to a hue with ~1/360 collision odds.
export function getEmployeeColor(key: string): EmployeeColor {
  let hash = 5381
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0
  }
  return hueColor(Math.abs(hash) % 360)
}

/**
 * Build a stable id -> color map by walking a deterministically-sorted id list
 * and spacing hues by the golden angle. This gives every employee a DISTINCT,
 * evenly-spread color (no fixed-palette cycling) that stays consistent across
 * day/week/month navigation as long as the same id set is passed in.
 */
export function buildEmployeeColorMap(ids: string[]): Record<string, EmployeeColor> {
  const sorted = Array.from(new Set(ids)).sort()
  const map: Record<string, EmployeeColor> = {}
  sorted.forEach((id, i) => { map[id] = hueColor(i * GOLDEN_ANGLE) })
  return map
}

export interface ScheduleExportEntry {
  employeeName: string
  employeeKey: string
  location: string | null
  date: string        // YYYY-MM-DD
  dayOfWeek: string    // e.g. "Monday"
  startTime: string    // HH:MM[:SS]
  endTime: string
  status?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function csvCell(value: string): string {
  return `"${(value ?? '').replace(/"/g, '""')}"`
}

/** Download the schedule as a CSV file. */
export function exportScheduleCSV(entries: ScheduleExportEntry[], filename: string) {
  const headers = ['Employee', 'Location', 'Date', 'Day', 'Start', 'End', 'Status']
  const rows = entries.map(e => [
    e.employeeName,
    e.location || '',
    e.date,
    e.dayOfWeek,
    formatTimeString(e.startTime),
    formatTimeString(e.endTime),
    e.status || '',
  ])

  const csv = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Open a print-friendly window with a clean weekly schedule table and trigger
 * the print dialog (user can "Save as PDF"). No external dependency.
 */
export function exportSchedulePDF(
  entries: ScheduleExportEntry[],
  title: string,
  getColor: (key: string) => EmployeeColor = getEmployeeColor,
) {
  // Group entries by date (chronological).
  const byDate = new Map<string, ScheduleExportEntry[]>()
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, [])
    byDate.get(e.date)!.push(e)
  }
  const dates = Array.from(byDate.keys()).sort()

  const sections = dates.map(date => {
    const dayEntries = byDate.get(date)!
      .slice()
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
    const rows = dayEntries.map(e => {
      const c = getColor(e.employeeKey)
      return `<tr>
        <td><span class="chip" style="background:${c.bg};color:${c.text};border-left:4px solid ${c.border}">${escapeHtml(e.employeeName)}</span></td>
        <td>${escapeHtml(e.location || '—')}</td>
        <td>${escapeHtml(formatTimeString(e.startTime))} – ${escapeHtml(formatTimeString(e.endTime))}</td>
      </tr>`
    }).join('')
    return `<h2>${escapeHtml(formatScheduleDate(date))}</h2>
      <table>
        <thead><tr><th>Employee</th><th>Location</th><th>Hours</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#111827; padding:24px; }
      h1 { font-size:22px; margin:0 0 4px; }
      .sub { color:#6b7280; font-size:13px; margin:0 0 20px; }
      h2 { font-size:15px; margin:20px 0 6px; border-bottom:2px solid #e5e7eb; padding-bottom:4px; }
      table { width:100%; border-collapse:collapse; margin-bottom:8px; }
      th { text-align:left; font-size:11px; text-transform:uppercase; color:#6b7280; padding:6px 8px; border-bottom:1px solid #e5e7eb; }
      td { padding:6px 8px; font-size:13px; border-bottom:1px solid #f3f4f6; }
      .chip { display:inline-block; padding:3px 10px; border-radius:6px; font-weight:600; }
      @media print { body { padding:0; } }
    </style></head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      <p class="sub">${escapeHtml(`${entries.length} shift${entries.length === 1 ? '' : 's'} • generated ${formatScheduleDate(new Date().toISOString().slice(0, 10))}`)}</p>
      ${sections || '<p>No shifts scheduled for this period.</p>'}
    </body></html>`

  const win = window.open('', '_blank')
  if (!win) {
    alert('Please allow pop-ups to export the schedule as PDF.')
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  // Give the browser a tick to render before printing.
  setTimeout(() => win.print(), 300)
}

/**
 * Render a DOM element to a PNG and download it. Uses html2canvas (loaded
 * dynamically so it only ships when an export is actually triggered).
 */
export async function exportSchedulePNG(element: HTMLElement, filename: string) {
  // html-to-image captures the element's full content bounds reliably (no
  // viewport-height/scroll clipping like html2canvas had). Measure the full
  // scroll size so a horizontally-scrollable calendar is captured whole.
  const { toPng } = await import('html-to-image')
  const width = Math.ceil(Math.max(element.scrollWidth, element.offsetWidth))
  const height = Math.ceil(Math.max(element.scrollHeight, element.offsetHeight))
  const url = await toPng(element, {
    backgroundColor: '#ffffff',
    pixelRatio: 2,
    width,
    height,
    cacheBust: true,
    // Pin the clone's box to the full size so nothing is cut off.
    style: { width: `${width}px`, height: `${height}px` },
  })
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

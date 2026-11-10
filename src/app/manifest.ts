import type { MetadataRoute } from 'next'

// Web app manifest — makes the employee portal installable as a home-screen app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/employee',
    name: 'PlayFunia Employee',
    short_name: 'PlayFunia',
    description: 'Clock in, check your schedule and tasks at PlayFunia.',
    start_url: '/employee?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#6366f1',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'My Schedule', url: '/employee/schedules', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'My Tasks', url: '/employee/tasks', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Time Card', url: '/employee/attendance', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  }
}

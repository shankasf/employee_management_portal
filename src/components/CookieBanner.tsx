'use client'

import { useEffect, useState } from 'react'
import { hasConsentChoice, setCookieConsent } from '@/lib/cookiePreferences'

export function CookieBanner() {
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    // Only show banner if user hasn't made a choice yet
    const timer = setTimeout(() => {
      if (!hasConsentChoice()) {
        setShowBanner(true)
      }
    }, 1000) // Delay to avoid flash on page load

    return () => clearTimeout(timer)
  }, [])

  const handleAccept = () => {
    setCookieConsent('accepted')
    setShowBanner(false)
    // Reload to apply new cache settings
    window.location.reload()
  }

  const handleDecline = () => {
    setCookieConsent('declined')
    setShowBanner(false)
  }

  if (!showBanner) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-lg">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-sm text-gray-600 dark:text-gray-300">
          <p className="font-medium text-gray-900 dark:text-white mb-1">Enable faster page loads?</p>
          <p>Accept cookies to enable aggressive caching for instant page refreshes and faster navigation.</p>
        </div>
        <div className="flex gap-3 shrink-0">
          <button
            onClick={handleDecline}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            No thanks
          </button>
          <button
            onClick={handleAccept}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}

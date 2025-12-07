import Link from 'next/link'
import { createUntypedClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function HomePage() {
  const supabase = await createUntypedClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'admin') {
      redirect('/admin')
    } else {
      redirect('/employee')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
      <div className="text-center space-y-8 p-8">
        <div className="space-y-4">
          <h1 className="text-5xl font-bold text-indigo-600 dark:text-indigo-400">
            🎢 PlayFunia
          </h1>
          <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300">
            Employee Management Portal
          </h2>
          <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto">
            Clock in, manage tasks, view schedules, and stay connected with your team.
          </p>
        </div>

        <div className="space-y-4">
          <Link
            href="/login"
            className="btn-primary inline-flex items-center gap-2 px-8 py-3 text-lg"
          >
            Sign In to Continue
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
        </div>

        <div className="pt-8 text-sm text-gray-500 dark:text-gray-400">
          <p>Need help? Contact your manager or administrator.</p>
        </div>
      </div>
    </div>
  )
}

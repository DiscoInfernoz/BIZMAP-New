'use client'

import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function Navigation() {
  const { user, profile, signOut, loading } = useAuth()
  const router = useRouter()

  const handleSignOut = async () => {
    try {
      await signOut()
      router.push('/login')
    } catch (error) {
      console.error('Error signing out:', error)
    }
  }

  if (loading) {
    return null // Don't render anything while loading
  }

  if (!user) {
    return null // Don't render navigation for non-authenticated users
  }

  return (
    <nav className="bg-slate-900/50 backdrop-blur-xl border-b border-white/10 p-4">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center space-x-6">
          <Link href="/upload" className="text-2xl font-bold">
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              BIZMAP
            </span>
          </Link>
          <div className="flex space-x-4">
            <Link 
              href="/upload" 
              className="text-slate-300 hover:text-white transition-colors"
            >
              Upload
            </Link>
            <Link 
              href="/report" 
              className="text-slate-300 hover:text-white transition-colors"
            >
              Reports
            </Link>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {profile && (
            <span className="text-slate-300 text-sm">
              {profile.business_name}
            </span>
          )}
          <button
            onClick={handleSignOut}
            className="text-slate-300 hover:text-white transition-colors text-sm"
          >
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  )
}


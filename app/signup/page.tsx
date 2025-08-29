'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  const { signUp } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email || !password || !businessName) {
      setError('Please fill in all required fields')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      await signUp(email, password, businessName, phone)
      setSuccess('Account created successfully! Please check your email to verify your account.')
      
      // Redirect after short delay to let user read success message
      setTimeout(() => {
        router.push('/login')
      }, 3000)
    } catch (err: any) {
      setError(err.message || 'An error occurred during sign up')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
      <div className="glass-card p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              Get Started
            </span>
          </h1>
          <p className="text-slate-300">Create your BIZMAP account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="businessName" className="block text-sm font-semibold text-white mb-2">
              Business Name *
            </label>
            <input
              id="businessName"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full p-3 glass-card border border-white/20 rounded-xl focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-white bg-white/5 placeholder-slate-400"
              placeholder="Enter your business name"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-white mb-2">
              Email Address *
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 glass-card border border-white/20 rounded-xl focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-white bg-white/5 placeholder-slate-400"
              placeholder="Enter your email"
              required
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-semibold text-white mb-2">
              Phone Number
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full p-3 glass-card border border-white/20 rounded-xl focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-white bg-white/5 placeholder-slate-400"
              placeholder="Enter your phone number (optional)"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-white mb-2">
              Password *
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 glass-card border border-white/20 rounded-xl focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-white bg-white/5 placeholder-slate-400"
              placeholder="Choose a password (min 6 characters)"
              required
              minLength={6}
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white py-3 px-4 rounded-xl font-semibold transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-slate-300">
            Already have an account?{' '}
            <Link href="/login" className="text-emerald-400 hover:text-emerald-300 font-semibold">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
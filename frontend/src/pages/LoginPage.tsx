import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthTokens } from '../auth/cognito'
import { useAuth } from '../auth/AuthContext'

type CompleteNewPassword = (newPassword: string) => Promise<AuthTokens>

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null)
  const [completeNewPassword, setCompleteNewPassword] = useState<CompleteNewPassword | null>(null)
  const { login, setTokens } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const result = await login(email, password)
      if (result.status === 'newPasswordRequired') {
        setCompleteNewPassword(() => result.completeNewPassword)
        setPassword('')
      } else {
        navigate('/dashboard')
      }
    } catch {
      setError('Invalid email or password.')
    }
  }

  async function handleNewPasswordSubmit(event: FormEvent) {
    event.preventDefault()
    setNewPasswordError(null)
    try {
      const tokens = await completeNewPassword!(newPassword)
      setTokens(tokens)
      navigate('/dashboard')
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'InvalidPasswordException') {
        setNewPasswordError(
          'Password must be at least 10 characters and include uppercase, lowercase, and a number.',
        )
      } else {
        setNewPasswordError('Could not set new password. Please try again.')
      }
    }
  }

  if (completeNewPassword) {
    return (
      <div className="bg-[#0F172A] min-h-screen flex items-center justify-center p-4">
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 w-full max-w-sm backdrop-blur-sm">
          <h1 className="text-amber-400 font-bold text-2xl text-center mb-1">Boombayan LMS</h1>
          <p className="text-slate-500 text-sm text-center mb-8">Back-office management</p>

          <form onSubmit={handleNewPasswordSubmit} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="block text-xs font-medium text-slate-400 mb-1">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
              />
            </div>

            {newPasswordError && (
              <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
                {newPasswordError}
              </p>
            )}

            <button
              type="submit"
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
            >
              Set password
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#0F172A] min-h-screen flex items-center justify-center p-4">
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 w-full max-w-sm backdrop-blur-sm">
        <h1 className="text-amber-400 font-bold text-2xl text-center mb-1">Boombayan LMS</h1>
        <p className="text-slate-500 text-sm text-center mb-8">Back-office management</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-slate-400 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-slate-400 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            />
          </div>

          {error && (
            <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
          >
            Log in
          </button>
        </form>
      </div>
    </div>
  )
}

import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function AddMemberPage() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { idToken } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!idToken) return
    setError(null)
    try {
      const member = await apiFetch<Member>('/members', idToken, {
        method: 'POST',
        body: { first_name: firstName, last_name: lastName, email, phone },
      })
      navigate(`/members/${member.member_id}`)
    } catch {
      setError('Could not create member.')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-50 mb-6">Add member</h1>
      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6 max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="first-name" className="block text-xs font-medium text-slate-400 mb-1">First name</label>
            <input
              id="first-name"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            />
          </div>
          <div>
            <label htmlFor="last-name" className="block text-xs font-medium text-slate-400 mb-1">Last name</label>
            <input
              id="last-name"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-slate-400 mb-1">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-xs font-medium text-slate-400 mb-1">Phone</label>
            <input
              id="phone"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            />
          </div>
          {error && (
            <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
              {error}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
            >
              Create member
            </button>
            <button
              type="button"
              onClick={() => navigate('/members')}
              className="bg-white/[0.08] hover:bg-white/[0.12] text-slate-300 border border-white/10 px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

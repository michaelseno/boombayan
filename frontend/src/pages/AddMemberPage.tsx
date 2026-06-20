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
    <form onSubmit={handleSubmit}>
      <h1>Add member</h1>
      <label htmlFor="first-name">First name</label>
      <input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
      <label htmlFor="last-name">Last name</label>
      <input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <label htmlFor="phone">Phone</label>
      <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Create member</button>
    </form>
  )
}

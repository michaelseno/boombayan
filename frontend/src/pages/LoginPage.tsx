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
      <form onSubmit={handleNewPasswordSubmit}>
        <h1>Set a new password</h1>
        <p>Your account requires a new password before you can continue.</p>
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        {newPasswordError && <p role="alert">{newPasswordError}</p>}
        <button type="submit">Set password</button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Boombayan LMS</h1>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Log in</button>
    </form>
  )
}

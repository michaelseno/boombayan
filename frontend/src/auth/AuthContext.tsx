import { createContext, ReactNode, useContext, useEffect, useState } from 'react'
import { AuthTokens, LoginResult, login as cognitoLogin } from './cognito'

// Plaintext localStorage is an intentional, proportionate choice for this
// app's threat model (internal tool, ~5 known board members) — a JWT is
// already an unencrypted bearer credential the moment it exists in JS
// memory, so this isn't removing any encryption that would otherwise
// exist. The real tradeoff vs. an httpOnly cookie is XSS exposure surface,
// and adopting cookies would require backend cookie-setting/CORS work that
// doesn't exist anywhere in this plan. Revisit if the threat model changes.
const STORAGE_KEY = 'boombayan.auth.idToken'

interface AuthContextValue {
  idToken: string | null
  login: (email: string, password: string) => Promise<LoginResult>
  setTokens: (tokens: AuthTokens) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [idToken, setIdToken] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  )

  useEffect(() => {
    if (idToken) {
      localStorage.setItem(STORAGE_KEY, idToken)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [idToken])

  async function login(email: string, password: string): Promise<LoginResult> {
    const result = await cognitoLogin(email, password)
    if (result.status === 'success') {
      setIdToken(result.tokens.idToken)
    }
    return result
  }

  function setTokens(tokens: AuthTokens) {
    // accessToken/refreshToken are intentionally not persisted: nothing
    // downstream needs them yet (the API client only sends idToken), and
    // there's no session-refresh flow in this plan — the ID token's
    // ~1-hour Cognito expiry forces a full re-login, not a silent refresh.
    setIdToken(tokens.idToken)
  }

  function logout() {
    setIdToken(null)
  }

  return (
    <AuthContext.Provider value={{ idToken, login, setTokens, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

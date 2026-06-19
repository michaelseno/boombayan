import { createContext, ReactNode, useContext, useEffect, useState } from 'react'
import { AuthTokens, LoginResult, login as cognitoLogin } from './cognito'

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

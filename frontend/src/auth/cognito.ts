import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'

export interface AuthTokens {
  idToken: string
  accessToken: string
  refreshToken: string
}

export type LoginResult =
  | { status: 'success'; tokens: AuthTokens }
  | { status: 'newPasswordRequired'; completeNewPassword: (newPassword: string) => Promise<AuthTokens> }

function getUserPool(): CognitoUserPool {
  return new CognitoUserPool({
    UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
    ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
  })
}

function tokensFromSession(session: CognitoUserSession): AuthTokens {
  return {
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
  }
}

// Only onSuccess/onFailure/newPasswordRequired are handled below because
// this User Pool has no MFA configured (see infra/serverless.yml). If MFA
// is ever added, authenticateUser would call mfaRequired/totpRequired
// instead, which this function doesn't handle — the returned promise would
// never resolve or reject.
export function login(email: string, password: string): Promise<LoginResult> {
  const userPool = getUserPool()
  const cognitoUser = new CognitoUser({ Username: email, Pool: userPool })
  const authDetails = new AuthenticationDetails({ Username: email, Password: password })

  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        resolve({ status: 'success', tokens: tokensFromSession(session) })
      },
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        resolve({
          status: 'newPasswordRequired',
          completeNewPassword: (newPassword: string) =>
            new Promise((resolveChallenge, rejectChallenge) => {
              cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
                onSuccess: (session) => resolveChallenge(tokensFromSession(session)),
                onFailure: (err) => rejectChallenge(err),
              })
            }),
        })
      },
    })
  })
}

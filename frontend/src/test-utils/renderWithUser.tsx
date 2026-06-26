import { render } from '@testing-library/react'
import { CurrentUserContext, CurrentUser } from '../auth/CurrentUserContext'

const defaultAdminUser: CurrentUser = {
  user_id: 'admin-1',
  email: 'admin@boombayan.org',
  is_administrator: true,
  member_id: null,
}

export function renderWithUser(ui: React.ReactElement, user: CurrentUser = defaultAdminUser) {
  return render(
    <CurrentUserContext.Provider value={{ currentUser: user, loading: false, error: null }}>
      {ui}
    </CurrentUserContext.Provider>,
  )
}

import { BarChart2, CreditCard, RefreshCw, Settings, Users } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useCurrentUser } from '../auth/CurrentUserContext'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-150 ${
    isActive
      ? 'bg-white/10 text-white font-medium'
      : 'text-slate-400 hover:text-white hover:bg-white/5'
  }`

export function AppShell() {
  const { currentUser } = useCurrentUser()
  const { logout } = useAuth()

  return (
    <div className="flex h-screen overflow-hidden bg-[#0F172A]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-amber-500 focus:text-slate-900 focus:rounded-lg focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>

      {/* Sidebar */}
      <aside className="w-64 flex flex-col bg-[#0F172A] border-r border-white/10 shrink-0">
        {/* App name */}
        <div className="px-6 py-5 border-b border-white/[0.08]">
          <span className="text-amber-400 font-bold text-lg tracking-tight">Boombayan LMS</span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <NavLink to="/members" className={navLinkClass}>
            <Users className="w-4 h-4 shrink-0" />
            Members
          </NavLink>
          <NavLink to="/loans" className={navLinkClass}>
            <CreditCard className="w-4 h-4 shrink-0" />
            Loans
          </NavLink>
          <NavLink to="/cycles" className={navLinkClass}>
            <RefreshCw className="w-4 h-4 shrink-0" />
            Cycles
          </NavLink>

          {/* Reports — stubbed, activated in Plan 6b */}
          <div
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 cursor-not-allowed"
            title="Coming soon"
          >
            <BarChart2 className="w-4 h-4 shrink-0" />
            Reports
          </div>

          {currentUser?.is_administrator && (
            <NavLink to="/settings" className={navLinkClass}>
              <Settings className="w-4 h-4 shrink-0" />
              Settings
            </NavLink>
          )}
        </nav>

        {/* User zone */}
        <div className="px-4 py-4 border-t border-white/[0.08] space-y-2">
          <p className="text-xs text-slate-500 truncate px-1">{currentUser?.email}</p>
          <button
            type="button"
            onClick={logout}
            className="w-full text-left text-sm text-slate-400 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition-colors duration-150 cursor-pointer"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main id="main-content" className="flex-1 overflow-y-auto p-8 min-w-0">
        <Outlet />
      </main>
    </div>
  )
}

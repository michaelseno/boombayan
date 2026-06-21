import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AddMemberPage } from './pages/AddMemberPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoanDetailPage } from './pages/LoanDetailPage'
import { LoansPage } from './pages/LoansPage'
import { LoginPage } from './pages/LoginPage'
import { MemberDetailPage } from './pages/MemberDetailPage'
import { MembersPage } from './pages/MembersPage'
import { NewLoanPage } from './pages/NewLoanPage'
import { SettingsPage } from './pages/SettingsPage'

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/members/new" element={<AddMemberPage />} />
            <Route path="/members/:memberId" element={<MemberDetailPage />} />
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/loans/new" element={<NewLoanPage />} />
            <Route path="/loans/:loanId" element={<LoanDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

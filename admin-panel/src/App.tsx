import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import DashboardLayout from './layouts/DashboardLayout'
import MessagesPage from './pages/MessagesPage'
import AppointmentsPage from './pages/AppointmentsPage'
import AccountingPage from './pages/AccountingPage'
import TeamPage from './pages/TeamPage'
import ServicesPage from './pages/ServicesPage'
import ServiceDescriptionPage from './pages/ServiceDescriptionPage'
import UserManagementPage from './pages/UserManagementPage'
import DashboardPage from './pages/DashboardPage'

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { session, profile, loading } = useAuth()

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-dim)' }}>
      Yükleniyor…
    </div>
  )

  if (!session || !profile || !profile.is_active) return <Navigate to="/" replace />
  if (adminOnly && profile.role !== 'admin') return <Navigate to="/randevular" replace />

  return <>{children}</>
}

function AppRoutes() {
  const { session, profile, loading } = useAuth()

  if (loading) return null

  return (
    <Routes>
      <Route
        path="/"
        element={session && profile ? <Navigate to="/randevular" replace /> : <LoginPage />}
      />
      <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route path="randevular" element={<AppointmentsPage />} />
        <Route path="mesajlar"   element={<MessagesPage />} />
        <Route
          path="dashboard"
          element={<ProtectedRoute adminOnly><DashboardPage /></ProtectedRoute>}
        />
        <Route
          path="muhasebe"
          element={<ProtectedRoute adminOnly><AccountingPage /></ProtectedRoute>}
        />
        <Route
          path="ekip"
          element={<ProtectedRoute adminOnly><TeamPage /></ProtectedRoute>}
        />
        <Route
          path="hizmetler"
          element={<ProtectedRoute adminOnly><ServicesPage /></ProtectedRoute>}
        />
        <Route
          path="hizmetler/:id/aciklama"
          element={<ProtectedRoute adminOnly><ServiceDescriptionPage /></ProtectedRoute>}
        />
        <Route
          path="kullanicilar"
          element={<ProtectedRoute adminOnly><UserManagementPage /></ProtectedRoute>}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

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
import DashboardPage from './pages/DashboardPage'
import HolidaysPage from './pages/HolidaysPage'
import EmployeeCreatePage from './pages/EmployeeCreatePage'
import EmployeeDetailPage from './pages/EmployeeDetailPage'
import EmployeeSchedulePage from './pages/EmployeeSchedulePage'
import EmployeeLeavesPage from './pages/EmployeeLeavesPage'
import SettingsPage from './pages/SettingsPage'
import GiderlerPage from './pages/GiderlerPage'
import CustomersPage from './pages/CustomersPage'
import CustomerDetailPage from './pages/CustomerDetailPage'
import PerformanceReportPage from './pages/PerformanceReportPage'
import MorePage from './pages/MorePage'
import AdInsightsPage from './pages/AdInsightsPage'
import AiInsightsPage from './pages/AiInsightsPage'
import AdOAuthCallbackPage from './pages/AdOAuthCallbackPage'
import TopluMesajPage from './pages/TopluMesajPage'

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
        element={session && profile ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route path="randevular" element={<AppointmentsPage />} />
        <Route path="mesajlar"   element={<MessagesPage />} />
        <Route path="ayarlar"    element={<SettingsPage />} />
        <Route path="musteriler" element={<CustomersPage />} />
        <Route path="musteriler/:id" element={<CustomerDetailPage />} />
        <Route path="daha-fazla" element={<MorePage />} />
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
          path="ekip/tatiller"
          element={<ProtectedRoute adminOnly><HolidaysPage /></ProtectedRoute>}
        />
        <Route
          path="ekip/yeni"
          element={<ProtectedRoute adminOnly><EmployeeCreatePage /></ProtectedRoute>}
        />
        <Route
          path="ekip/:id"
          element={<ProtectedRoute adminOnly><EmployeeDetailPage /></ProtectedRoute>}
        />
        <Route
          path="ekip/:id/saatler"
          element={<ProtectedRoute adminOnly><EmployeeSchedulePage /></ProtectedRoute>}
        />
        <Route
          path="ekip/:id/izinler"
          element={<ProtectedRoute adminOnly><EmployeeLeavesPage /></ProtectedRoute>}
        />
        <Route
          path="giderler"
          element={<ProtectedRoute adminOnly><GiderlerPage /></ProtectedRoute>}
        />
        <Route
          path="performans-raporu"
          element={<ProtectedRoute adminOnly><PerformanceReportPage /></ProtectedRoute>}
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
          path="reklam"
          element={<ProtectedRoute adminOnly><AdInsightsPage /></ProtectedRoute>}
        />
        <Route
          path="reklam-callback"
          element={<ProtectedRoute adminOnly><AdOAuthCallbackPage /></ProtectedRoute>}
        />
        <Route
          path="ai-analiz"
          element={<ProtectedRoute adminOnly><AiInsightsPage /></ProtectedRoute>}
        />
        <Route
          path="toplu-mesaj"
          element={<ProtectedRoute adminOnly><TopluMesajPage /></ProtectedRoute>}
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

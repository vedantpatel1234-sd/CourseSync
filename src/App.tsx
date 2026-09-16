import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import LoginPage from './pages/LoginPage'
import AppLayout from './components/layout/AppLayout'
import TermsModal from './components/TermsModal'
import SessionWarningModal from './components/SessionWarningModal'
import { useAuthStore } from './stores/authStore'
import { supabase } from './lib/supabase'
import AdminDashboard from './pages/admin/Dashboard'
import AdminCourses from './pages/admin/Courses'
import AdminSections from './pages/admin/Sections'
import AdminTerms from './pages/admin/Terms'
import AdminInstructors from './pages/admin/Instructors'
import AdminAssignments from './pages/admin/Assignments'
import AdminCalendar from './pages/admin/Calendar'
import AdminAudit from './pages/admin/Audit'
import AdminAnalytics from './pages/admin/Analytics'
import AdminAI from './pages/admin/AI'
import AdminMatching from './pages/admin/Matching'
import AdminDrafts from './pages/admin/Drafts'
import AdminDraftDetail from './pages/admin/DraftDetail'
import AdminImport from './pages/admin/Import'
import AdminDigest from './pages/admin/Digest'
import AdminHelp from './pages/admin/Help'
import InstructorDashboard from './pages/instructor/Dashboard'
import InstructorQualifications from './pages/instructor/Qualifications'
import InstructorAvailability from './pages/instructor/Availability'
import InstructorNotifications from './pages/instructor/Notifications'
import InstructorPreferences from './pages/instructor/Preferences'
import InstructorHelp from './pages/instructor/Help'
import CoordinatorDashboard from './pages/coordinator/Dashboard'
import CoordinatorAssignments from './pages/coordinator/Assignments'
import CoordinatorInstructors from './pages/coordinator/Instructors'
import CoordinatorAnalytics from './pages/coordinator/Analytics'
import CoordinatorHelp from './pages/coordinator/Help'

function ProtectedRoute({ children, role }: { children: React.ReactNode, role: string }) {
  const { user } = useAuthStore()
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null)

  useEffect(() => {
    const checkTerms = async () => {
      if (!user) return
      const { data } = await supabase
        .from('terms_acceptance')
        .select('id')
        .eq('user_id', user.id)
        .single()
      setTermsAccepted(!!data)
    }
    if (user) checkTerms()
  }, [user])

  if (!user) return <Navigate to="/login" />
  if (user.role !== role) return <Navigate to="/login" />

  if (termsAccepted === false) {
    return <TermsModal onAccepted={() => setTermsAccepted(true)} />
  }

  if (termsAccepted === null) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: 'DM Sans, sans-serif', color: '#6B6B80'
      }}>
        Loading...
      </div>
    )
  }

  return <>{children}</>
}

function App() {
  const { initialize, showWarning, dismissWarning, signOut, user } = useAuthStore()

  useEffect(() => {
    initialize()
  }, [])

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route path="/admin" element={
          <ProtectedRoute role="admin">
            <AppLayout />
          </ProtectedRoute>
        }>
          <Route index element={<AdminDashboard />} />
          <Route path="courses" element={<AdminCourses />} />
          <Route path="sections" element={<AdminSections />} />
          <Route path="terms" element={<AdminTerms />} />
          <Route path="instructors" element={<AdminInstructors />} />
          <Route path="assignments" element={<AdminAssignments />} />
          <Route path="calendar" element={<AdminCalendar />} />
          <Route path="audit" element={<AdminAudit />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="ai" element={<AdminAI />} />
          <Route path="matching" element={<AdminMatching />} />
          <Route path="drafts" element={<AdminDrafts />} />
          <Route path="drafts/:draftId" element={<AdminDraftDetail />} />
          <Route path="import" element={<AdminImport />} />
          <Route path="digest" element={<AdminDigest />} />
          <Route path="help" element={<AdminHelp />} />
        </Route>

        <Route path="/instructor" element={
          <ProtectedRoute role="instructor">
            <AppLayout />
          </ProtectedRoute>
        }>
          <Route index element={<InstructorDashboard />} />
          <Route path="qualifications" element={<InstructorQualifications />} />
          <Route path="preferences" element={<InstructorPreferences />} />
          <Route path="availability" element={<InstructorAvailability />} />
          <Route path="notifications" element={<InstructorNotifications />} />
          <Route path="help" element={<InstructorHelp />} />
        </Route>

        <Route path="/coordinator" element={
          <ProtectedRoute role="coordinator">
            <AppLayout />
          </ProtectedRoute>
        }>
          <Route index element={<CoordinatorDashboard />} />
          <Route path="assignments" element={<CoordinatorAssignments />} />
          <Route path="instructors" element={<CoordinatorInstructors />} />
          <Route path="analytics" element={<CoordinatorAnalytics />} />
          <Route path="help" element={<CoordinatorHelp />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>

      {user && showWarning && (
        <SessionWarningModal
          secondsLeft={60}
          onStayLoggedIn={dismissWarning}
          onLogout={signOut}
        />
      )}
    </>
  )
}

export default App
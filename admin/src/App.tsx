import { useState, useCallback, useEffect } from 'react'
import { Toaster, toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { useKeyboard } from '@/hooks/use-keyboard'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { GlobalSearch } from '@/components/shared/global-search'
import { LoginPage } from '@/pages/login'
import { OverviewPage } from '@/pages/overview'
import { SubmissionsPage } from '@/pages/submissions'
import { FeaturePhotosPage } from '@/pages/feature-photos'
import { ResortsPage } from '@/pages/resorts'
import { UsersPage } from '@/pages/users'
import { SupportPage } from '@/pages/support'
import { RoadmapPage } from '@/pages/roadmap'
import { VisitsPage } from '@/pages/visits'
import { AnalyticsPage } from '@/pages/analytics'
import { ActivityPage } from '@/pages/activity'
import { SystemPage } from '@/pages/system'
import { supabase } from '@/lib/supabase'
import type { PageId } from '@/lib/constants'
import { Loader2 } from 'lucide-react'

export default function App() {
  const { user, loading, error, isAdmin, signIn, signOut } = useAuth()
  const [currentPage, setCurrentPage] = useState<PageId>('overview')
  const [searchOpen, setSearchOpen] = useState(false)
  const [badges, setBadges] = useState<Record<string, number>>({})

  const handleNavigate = useCallback((page: PageId) => {
    setCurrentPage(page)
  }, [])

  const handleSearchOpen = useCallback(() => {
    setSearchOpen(true)
  }, [])

  useKeyboard({ onNavigate: handleNavigate, onSearch: handleSearchOpen })

  // Load badge counts
  useEffect(() => {
    if (!user || !isAdmin) return

    async function loadBadges() {
      try {
        const [submissions, photos, tickets] = await Promise.all([
          supabase.from('resort_submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('resort_feature_photo_submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('support_requests').select('*', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']),
        ])
        setBadges({
          pendingSubmissions: submissions.count ?? 0,
          pendingPhotos: photos.count ?? 0,
          pendingTickets: tickets.count ?? 0,
        })
      } catch {
        // Silently fail — badges are non-critical
      }
    }

    loadBadges()
    const interval = setInterval(loadBadges, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [user, isAdmin])

  // Loading screen
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slope-slate-dark to-slope-slate-darker">
        <img
          src="https://rnudbfdhrenesamdjzdk.supabase.co/storage/v1/object/public/brand-assets/logo-light.png"
          alt="SlopeStory"
          className="h-12 mb-6"
        />
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  // Auth screen
  if (!user || !isAdmin) {
    return (
      <>
        <LoginPage onSignIn={signIn} loading={loading} error={error} />
        <Toaster theme="dark" position="top-right" richColors />
      </>
    )
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'overview': return <OverviewPage />
      case 'submissions': return <SubmissionsPage />
      case 'feature-photos': return <FeaturePhotosPage />
      case 'resorts': return <ResortsPage />
      case 'users': return <UsersPage />
      case 'support': return <SupportPage />
      case 'roadmap': return <RoadmapPage />
      case 'visits': return <VisitsPage />
      case 'analytics': return <AnalyticsPage />
      case 'activity': return <ActivityPage />
      case 'system': return <SystemPage />
      default: return <OverviewPage />
    }
  }

  return (
    <>
      <DashboardLayout
        currentPage={currentPage}
        onNavigate={handleNavigate}
        badges={badges}
        userEmail={user.email ?? ''}
        onSignOut={signOut}
      >
        {renderPage()}
      </DashboardLayout>

      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onNavigate={handleNavigate}
      />

      <Toaster theme="dark" position="top-right" richColors />
    </>
  )
}

import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import type { PageId } from '@/lib/constants'

interface DashboardLayoutProps {
  currentPage: PageId
  onNavigate: (page: PageId) => void
  badges: Record<string, number>
  userEmail: string
  onSignOut: () => void
  children: ReactNode
}

export function DashboardLayout({
  currentPage,
  onNavigate,
  badges,
  userEmail,
  onSignOut,
  children,
}: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        badges={badges}
        userEmail={userEmail}
        onSignOut={onSignOut}
      />
      <main className="flex-1 lg:ml-64 min-h-screen flex flex-col">
        {children}
      </main>
    </div>
  )
}

import { useState } from 'react'
import {
  LayoutDashboard, Inbox, ImagePlus, Mountain, Users, LifeBuoy,
  Map, CalendarDays, BarChart3, ScrollText, Activity, LogOut, Menu, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PageId, NavItem } from '@/lib/constants'
import { NAV_ITEMS } from '@/lib/constants'

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  LayoutDashboard, Inbox, ImagePlus, Mountain, Users, LifeBuoy,
  Map, CalendarDays, BarChart3, ScrollText, Activity,
}

interface SidebarProps {
  currentPage: PageId
  onNavigate: (page: PageId) => void
  badges: Record<string, number>
  userEmail: string
  onSignOut: () => void
}

export function Sidebar({ currentPage, onNavigate, badges, userEmail, onSignOut }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-card border border-border lg:hidden"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 h-screen w-64 bg-slope-slate-dark border-r border-border flex flex-col z-50 transition-transform lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-3 px-5 py-5 border-b border-border">
          <img
            src="https://rnudbfdhrenesamdjzdk.supabase.co/storage/v1/object/public/brand-assets/logo-light.png"
            alt=""
            className="h-8"
          />
          <span className="font-semibold text-lg">SlopeStory</span>
          <span className="ml-auto text-[10px] font-semibold bg-primary text-white px-2 py-0.5 rounded">
            ADMIN
          </span>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-3">
          {NAV_ITEMS.map((item: NavItem) => {
            const Icon = ICON_MAP[item.icon]
            const badge = item.badgeKey ? badges[item.badgeKey] : 0
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id)
                  setMobileOpen(false)
                }}
                className={cn(
                  'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5',
                  currentPage === item.id
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {Icon && <Icon className="w-[18px] h-[18px] shrink-0" />}
                <span className="truncate">{item.label}</span>
                {badge > 0 && (
                  <span className="ml-auto text-[11px] font-semibold bg-destructive text-white px-2 py-0.5 rounded-full min-w-[20px] text-center">
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-3 p-3 bg-card rounded-lg">
            <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0">
              {userEmail.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">{userEmail}</div>
              <div className="text-[11px] text-muted-foreground">Administrator</div>
            </div>
            <button
              onClick={onSignOut}
              className="p-1.5 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

export const SUPABASE_URL = 'https://rnudbfdhrenesamdjzdk.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJudWRiZmRocmVuZXNhbWRqemRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2MjEwNTIsImV4cCI6MjA4NDE5NzA1Mn0.oxSYGKF5jkiTCWZblioMxYnKK8d-NGQkp5incBTYi3E'

// Client-side gate only. Real security is enforced by Supabase RLS + Edge Functions.
export const ADMIN_EMAILS = ['slopestoryapp@gmail.com', 'admin@slopestory.com']

export const PAGE_SIZE = 50

export type PageId =
  | 'overview'
  | 'submissions'
  | 'feature-photos'
  | 'resorts'
  | 'bulk-import'
  | 'users'
  | 'testers'
  | 'send-update'
  | 'beta-feedback'
  | 'support'
  | 'roadmap'
  | 'knowledge-base'
  | 'visits'
  | 'analytics'
  | 'activity'
  | 'system'

export interface NavItem {
  id: PageId
  label: string
  icon: string
  badgeKey?: string
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'LayoutDashboard' },
  { id: 'submissions', label: 'Submissions', icon: 'Inbox', badgeKey: 'pendingSubmissions' },
  { id: 'feature-photos', label: 'Feature Photos', icon: 'ImagePlus', badgeKey: 'pendingPhotos' },
  { id: 'resorts', label: 'Resorts', icon: 'Mountain' },
  { id: 'bulk-import', label: 'Bulk Import', icon: 'Upload' },
  { id: 'users', label: 'Users', icon: 'Users' },
  { id: 'testers', label: 'Testers', icon: 'FlaskConical' },
  { id: 'send-update', label: 'Send Update', icon: 'Megaphone' },
  { id: 'beta-feedback', label: 'Beta Feedback', icon: 'MessageSquareHeart' },
  { id: 'support', label: 'Support', icon: 'LifeBuoy', badgeKey: 'pendingTickets' },
  { id: 'roadmap', label: 'Roadmap', icon: 'Map' },
  { id: 'knowledge-base', label: 'Knowledge Base', icon: 'BookOpen' },
  { id: 'visits', label: 'Visits', icon: 'CalendarDays' },
  { id: 'analytics', label: 'Analytics', icon: 'BarChart3' },
  { id: 'activity', label: 'Activity Log', icon: 'ScrollText' },
  { id: 'system', label: 'System', icon: 'Activity' },
]

export const TICKET_CATEGORIES = [
  { value: 'resort_info', label: 'Resort Info', color: 'text-blue-400 bg-blue-400/10' },
  { value: 'missing_resort', label: 'Missing Resort', color: 'text-purple-400 bg-purple-400/10' },
  { value: 'bug', label: 'Bug Report', color: 'text-red-400 bg-red-400/10' },
  { value: 'feature', label: 'Feature Request', color: 'text-green-400 bg-green-400/10' },
  { value: 'account', label: 'Account', color: 'text-yellow-400 bg-yellow-400/10' },
  { value: 'other', label: 'Other', color: 'text-slate-400 bg-slate-400/10' },
]

export const TICKET_STATUSES = [
  { value: 'pending', label: 'Pending', color: 'text-yellow-400 bg-yellow-400/10' },
  { value: 'in_progress', label: 'In Progress', color: 'text-blue-400 bg-blue-400/10' },
  { value: 'resolved', label: 'Resolved', color: 'text-green-400 bg-green-400/10' },
  { value: 'closed', label: 'Closed', color: 'text-slate-400 bg-slate-400/10' },
]

export const COHORTS = [
  { value: 'phase1', label: 'Phase 1', color: 'text-blue-400 bg-blue-400/10' },
  { value: 'phase2', label: 'Phase 2', color: 'text-purple-400 bg-purple-400/10' },
  { value: 'phase3', label: 'Phase 3', color: 'text-green-400 bg-green-400/10' },
]

export const ROADMAP_STATUSES = [
  { value: 'exploring', label: 'Exploring' },
  { value: 'planned', label: 'Planned' },
  { value: 'dusted', label: 'Dusted' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
]

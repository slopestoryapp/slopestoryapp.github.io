import { useState, useEffect, useCallback } from 'react'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Mountain, Users, LifeBuoy, Inbox, CalendarDays } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { PageId } from '@/lib/constants'

interface SearchResult {
  id: string
  label: string
  sublabel: string
  type: 'resort' | 'user' | 'ticket' | 'submission' | 'visit'
  pageId: PageId
}

const ICONS = {
  resort: Mountain,
  user: Users,
  ticket: LifeBuoy,
  submission: Inbox,
  visit: CalendarDays,
}

interface GlobalSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (page: PageId) => void
}

export function GlobalSearch({ open, onOpenChange, onNavigate }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    const pattern = `%${q}%`

    const [resorts, users, tickets, submissions] = await Promise.all([
      supabase.from('resorts').select('id, name, country').ilike('name', pattern).limit(5),
      supabase.from('profiles').select('id, email, first_name, last_name').or(`email.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern},username.ilike.${pattern}`).limit(5),
      supabase.from('support_requests').select('id, message, category').ilike('message', pattern).limit(5),
      supabase.from('resort_submissions').select('id, resort_name, country').ilike('resort_name', pattern).limit(5),
    ])

    const items: SearchResult[] = [
      ...(resorts.data ?? []).map(r => ({
        id: r.id, label: r.name, sublabel: r.country ?? '', type: 'resort' as const, pageId: 'resorts' as PageId,
      })),
      ...(users.data ?? []).map(u => ({
        id: u.id, label: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email, sublabel: u.email ?? '', type: 'user' as const, pageId: 'users' as PageId,
      })),
      ...(tickets.data ?? []).map(t => ({
        id: t.id, label: t.message?.slice(0, 60) ?? t.category, sublabel: t.category, type: 'ticket' as const, pageId: 'support' as PageId,
      })),
      ...(submissions.data ?? []).map(s => ({
        id: s.id, label: s.resort_name, sublabel: s.country ?? '', type: 'submission' as const, pageId: 'submissions' as PageId,
      })),
    ]

    setResults(items)
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300)
    return () => clearTimeout(timer)
  }, [query, search])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
    }
  }, [open])

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = []
    acc[r.type].push(r)
    return acc
  }, {})

  const typeLabels: Record<string, string> = {
    resort: 'Resorts',
    user: 'Users',
    ticket: 'Support Tickets',
    submission: 'Submissions',
    visit: 'Visits',
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search resorts, users, tickets..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && <div className="py-6 text-center text-sm text-muted-foreground">Searching...</div>}
        <CommandEmpty>{query.length < 2 ? 'Type to search across all data...' : 'No results found.'}</CommandEmpty>
        {Object.entries(grouped).map(([type, items]) => {
          const Icon = ICONS[type as keyof typeof ICONS]
          return (
            <CommandGroup key={type} heading={typeLabels[type] ?? type}>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  onSelect={() => {
                    onNavigate(item.pageId)
                    onOpenChange(false)
                  }}
                >
                  <Icon className="w-4 h-4 mr-2 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <span className="block truncate">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.sublabel}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
      </CommandList>
    </CommandDialog>
  )
}

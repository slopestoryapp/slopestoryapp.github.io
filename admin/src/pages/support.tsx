import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { TICKET_CATEGORIES, TICKET_STATUSES } from '@/lib/constants'
import { formatDate, formatDateTime, timeAgo, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuditLog } from '@/hooks/use-audit-log'
import { Header } from '@/components/layout/header'
import { StatsCard } from '@/components/shared/stats-card'
import { ExportButton } from '@/components/shared/export-button'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Loader2,
  PlayCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Send,
  Plus,
  MessageSquare,
} from 'lucide-react'

interface SupportTicket {
  id: string
  category: string
  status: string
  message: string
  steps_to_reproduce: string | null
  why_useful: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  device_info: any
  resort_name: string | null
  resort_id: string | null
  screen_feature: string | null
  feature_title: string | null
  issue_type: string | null
  user_id: string | null
  created_at: string
  updated_at: string | null
}

interface SupportNote {
  id: string
  support_request_id: string
  admin_email: string
  note_text: string
  is_response_to_user: boolean
  created_at: string
}

export function SupportPage() {
  const { log } = useAuditLog()

  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [selected, setSelected] = useState<SupportTicket | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Stats
  const [pendingCount, setPendingCount] = useState(0)
  const [inProgressCount, setInProgressCount] = useState(0)
  const [resolvedMonthCount, setResolvedMonthCount] = useState(0)

  // Status update loading
  const [statusLoading, setStatusLoading] = useState(false)

  // Notes
  const [notes, setNotes] = useState<SupportNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [sendingResponse, setSendingResponse] = useState(false)

  const loadTickets = useCallback(async () => {
    try {
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)

      const [ticketsRes, pendingRes, inProgressRes, resolvedMonthRes] =
        await Promise.all([
          supabase
            .from('support_requests')
            .select('*')
            .order('created_at', { ascending: false }),
          supabase
            .from('support_requests')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending'),
          supabase
            .from('support_requests')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'in_progress'),
          supabase
            .from('support_requests')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'resolved')
            .gte('updated_at', startOfMonth.toISOString()),
        ])

      setTickets((ticketsRes.data as SupportTicket[]) ?? [])
      setPendingCount(pendingRes.count ?? 0)
      setInProgressCount(inProgressRes.count ?? 0)
      setResolvedMonthCount(resolvedMonthRes.count ?? 0)
    } catch {
      toast.error('Failed to load tickets')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadTickets()
  }, [loadTickets])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadTickets()
  }, [loadTickets])

  const loadNotes = useCallback(async (ticketId: string) => {
    setNotesLoading(true)
    try {
      const { data } = await supabase
        .from('support_request_notes')
        .select('*')
        .eq('support_request_id', ticketId)
        .order('created_at', { ascending: true })

      setNotes((data as SupportNote[]) ?? [])
    } catch {
      toast.error('Failed to load notes')
    } finally {
      setNotesLoading(false)
    }
  }, [])

  const selectTicket = useCallback(
    (ticket: SupportTicket) => {
      setSelected(ticket)
      setNewNote('')
      loadNotes(ticket.id)
    },
    [loadNotes]
  )

  const updateStatus = useCallback(
    async (newStatus: string) => {
      if (!selected) return
      setStatusLoading(true)

      const { error } = await supabase
        .from('support_requests')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', selected.id)

      if (error) {
        toast.error(`Failed to update status: ${error.message}`)
        setStatusLoading(false)
        return
      }

      await log({
        action: `ticket_${newStatus}`,
        entity_type: 'support_request',
        entity_id: selected.id,
        details: {
          from_status: selected.status,
          to_status: newStatus,
          category: selected.category,
        },
      })

      toast.success(`Ticket marked as ${newStatus.replace('_', ' ')}`)
      setSelected({ ...selected, status: newStatus })
      setStatusLoading(false)
      loadTickets()
    },
    [selected, log, loadTickets]
  )

  const handleAddNote = useCallback(async () => {
    if (!selected || !newNote.trim()) return
    setAddingNote(true)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const email = session?.user?.email ?? 'unknown'

      const { error } = await supabase.from('support_request_notes').insert({
        support_request_id: selected.id,
        admin_email: email,
        note_text: newNote.trim(),
        is_response_to_user: false,
      })

      if (error) {
        toast.error(`Failed to add note: ${error.message}`)
        return
      }

      await log({
        action: 'add_support_note',
        entity_type: 'support_request',
        entity_id: selected.id,
      })

      toast.success('Note added')
      setNewNote('')
      loadNotes(selected.id)
    } catch {
      toast.error('Failed to add note')
    } finally {
      setAddingNote(false)
    }
  }, [selected, newNote, log, loadNotes])

  const handleSendResponse = useCallback(async () => {
    if (!selected || !newNote.trim()) return
    setSendingResponse(true)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const email = session?.user?.email ?? 'unknown'

      const { error } = await supabase.from('support_request_notes').insert({
        support_request_id: selected.id,
        admin_email: email,
        note_text: newNote.trim(),
        is_response_to_user: true,
      })

      if (error) {
        toast.error(`Failed to send response: ${error.message}`)
        return
      }

      await log({
        action: 'send_support_response',
        entity_type: 'support_request',
        entity_id: selected.id,
      })

      // Note: send-support-response edge function will be created later
      toast.success('Response saved (email delivery pending edge function)')
      setNewNote('')
      loadNotes(selected.id)
    } catch {
      toast.error('Failed to send response')
    } finally {
      setSendingResponse(false)
    }
  }, [selected, newNote, log, loadNotes])

  // Client-side filtered tickets
  const filteredTickets = tickets.filter((t) => {
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    return true
  })

  const getCategoryConfig = useCallback((category: string) => {
    return (
      TICKET_CATEGORIES.find((c) => c.value === category) ?? {
        value: category,
        label: category,
        color: 'text-slate-400 bg-slate-400/10',
      }
    )
  }, [])

  const getStatusConfig = useCallback((status: string) => {
    return (
      TICKET_STATUSES.find((s) => s.value === status) ?? {
        value: status,
        label: status,
        color: 'text-slate-400 bg-slate-400/10',
      }
    )
  }, [])

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Support"
        subtitle="Manage support tickets and responses"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stats */}
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-3 gap-4">
              <StatsCard label="Pending" value={pendingCount} />
              <StatsCard label="In Progress" value={inProgressCount} />
              <StatsCard
                label="Resolved This Month"
                value={resolvedMonthCount}
              />
            </div>
          </div>
          <ExportButton
            data={tickets as unknown as Record<string, unknown>[]}
            filename="support-tickets"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {TICKET_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {TICKET_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-xs text-muted-foreground">
            {filteredTickets.length} ticket(s)
          </span>
        </div>

        {/* Main content: list + details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Ticket List */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold">Tickets</h2>
            </div>
            <ScrollArea className="max-h-[600px]">
              {loading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 rounded-lg" />
                  ))}
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No tickets found
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredTickets.map((ticket) => {
                    const cat = getCategoryConfig(ticket.category)
                    const stat = getStatusConfig(ticket.status)
                    return (
                      <button
                        key={ticket.id}
                        onClick={() => selectTicket(ticket)}
                        className={cn(
                          'w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors',
                          selected?.id === ticket.id && 'bg-accent'
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-md font-medium',
                              cat.color
                            )}
                          >
                            {cat.label}
                          </span>
                          <span
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-md font-medium',
                              stat.color
                            )}
                          >
                            {stat.label}
                          </span>
                        </div>
                        <div className="text-sm truncate">
                          {ticket.message.slice(0, 100)}
                          {ticket.message.length > 100 ? '...' : ''}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {timeAgo(ticket.created_at)}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Right: Ticket Details + Notes */}
          <div className="space-y-4">
            {/* Ticket Details */}
            <div className="bg-card border border-border rounded-xl">
              <div className="p-4 border-b border-border">
                <h2 className="text-sm font-semibold">Ticket Details</h2>
              </div>
              {selected ? (
                <div className="flex flex-col">
                  <div className="overflow-y-auto max-h-[50vh] p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">ID</span>
                        <p className="font-mono text-xs break-all">
                          {selected.id}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Category</span>
                        <p>
                          <span
                            className={cn(
                              'text-xs px-2 py-0.5 rounded-md font-medium',
                              getCategoryConfig(selected.category).color
                            )}
                          >
                            {getCategoryConfig(selected.category).label}
                          </span>
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Status</span>
                        <p>
                          <span
                            className={cn(
                              'text-xs px-2 py-0.5 rounded-md font-medium',
                              getStatusConfig(selected.status).color
                            )}
                          >
                            {getStatusConfig(selected.status).label}
                          </span>
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Created</span>
                        <p className="text-xs">
                          {formatDateTime(selected.created_at)}
                        </p>
                      </div>
                      {selected.updated_at && (
                        <div>
                          <span className="text-muted-foreground">
                            Updated
                          </span>
                          <p className="text-xs">
                            {formatDateTime(selected.updated_at)}
                          </p>
                        </div>
                      )}
                      {selected.user_id && (
                        <div>
                          <span className="text-muted-foreground">
                            User ID
                          </span>
                          <p className="font-mono text-xs break-all">
                            {selected.user_id}
                          </p>
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="text-xs text-muted-foreground">
                        Message
                      </span>
                      <p className="text-sm mt-1 whitespace-pre-wrap bg-muted/30 rounded-lg p-3">
                        {selected.message}
                      </p>
                    </div>

                    {/* Optional fields */}
                    {selected.steps_to_reproduce && (
                      <div>
                        <span className="text-xs text-muted-foreground">
                          Steps to Reproduce
                        </span>
                        <p className="text-sm mt-1 whitespace-pre-wrap">
                          {selected.steps_to_reproduce}
                        </p>
                      </div>
                    )}
                    {selected.why_useful && (
                      <div>
                        <span className="text-xs text-muted-foreground">
                          Why Useful
                        </span>
                        <p className="text-sm mt-1">{selected.why_useful}</p>
                      </div>
                    )}
                    {selected.device_info && (
                      <div>
                        <span className="text-xs text-muted-foreground">
                          Device Info
                        </span>
                        <p className="text-xs font-mono mt-1 whitespace-pre-wrap">
                          {typeof selected.device_info === 'object'
                            ? JSON.stringify(selected.device_info, null, 2)
                            : String(selected.device_info)}
                        </p>
                      </div>
                    )}
                    {selected.resort_name && (
                      <div>
                        <span className="text-xs text-muted-foreground">
                          Resort
                        </span>
                        <p className="text-sm mt-1">
                          {selected.resort_name}
                          {selected.resort_id && (
                            <span className="text-muted-foreground text-xs ml-1">
                              ({selected.resort_id})
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                    {selected.screen_feature && (
                      <div>
                        <span className="text-xs text-muted-foreground">
                          Screen / Feature
                        </span>
                        <p className="text-sm mt-1">
                          {selected.screen_feature}
                        </p>
                      </div>
                    )}
                    {selected.feature_title && (
                      <div>
                        <span className="text-xs text-muted-foreground">
                          Feature Title
                        </span>
                        <p className="text-sm mt-1">{selected.feature_title}</p>
                      </div>
                    )}
                    {selected.issue_type && (
                      <div>
                        <span className="text-xs text-muted-foreground">
                          Issue Type
                        </span>
                        <p className="text-sm mt-1">{selected.issue_type}</p>
                      </div>
                    )}
                  </div>

                  {/* Status Action Buttons — pinned below scroll */}
                  <div className="flex flex-wrap gap-2 p-4 border-t border-border">
                    {selected.status !== 'in_progress' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus('in_progress')}
                        disabled={statusLoading}
                      >
                        {statusLoading ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <PlayCircle className="w-4 h-4 mr-1" />
                        )}
                        In Progress
                      </Button>
                    )}
                    {selected.status !== 'resolved' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus('resolved')}
                        disabled={statusLoading}
                      >
                        {statusLoading ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                        )}
                        Resolved
                      </Button>
                    )}
                    {selected.status !== 'closed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus('closed')}
                        disabled={statusLoading}
                      >
                        {statusLoading ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <XCircle className="w-4 h-4 mr-1" />
                        )}
                        Close
                      </Button>
                    )}
                    {(selected.status === 'resolved' ||
                      selected.status === 'closed') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus('pending')}
                        disabled={statusLoading}
                      >
                        {statusLoading ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <RotateCcw className="w-4 h-4 mr-1" />
                        )}
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Select a ticket to view details
                </div>
              )}
            </div>

            {/* Admin Notes Section */}
            {selected && (
              <div className="bg-card border border-border rounded-xl">
                <div className="p-4 border-b border-border flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Admin Notes</h2>
                </div>

                {notesLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 rounded-lg" />
                    ))}
                  </div>
                ) : (
                  <ScrollArea className="max-h-[250px]">
                    {notes.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        No notes yet
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {notes.map((note) => (
                          <div key={note.id} className="px-4 py-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium">
                                {note.admin_email}
                              </span>
                              {note.is_response_to_user && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  Response
                                </Badge>
                              )}
                              <span className="text-[10px] text-muted-foreground ml-auto">
                                {timeAgo(note.created_at)}
                              </span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">
                              {note.note_text}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                )}

                {/* Add Note */}
                <div className="p-4 border-t border-border space-y-2">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Write a note or response..."
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px]"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAddNote}
                      disabled={addingNote || !newNote.trim()}
                    >
                      {addingNote ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-1" />
                      )}
                      Add Note
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSendResponse}
                      disabled={sendingResponse || !newNote.trim()}
                    >
                      {sendingResponse ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 mr-1" />
                      )}
                      Send Response
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { SUPABASE_URL } from '@/lib/constants'
import { formatDate, timeAgo, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuditLog } from '@/hooks/use-audit-log'
import { Header } from '@/components/layout/header'
import { StatsCard } from '@/components/shared/stats-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Check,
  X,
  Copy,
  Loader2,
  ImageIcon,
  Plus,
  Search,
  Users,
  Link2,
  Mountain,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PotentialMatch {
  id: string
  name: string
  country_code: string
  similarity: number
}

interface DuplicateSubmission {
  id: string
  resort_name: string
  country: string
  submitted_by: string | null
  similarity: number
}

interface Submission {
  id: string
  resort_name: string
  country: string
  region: string | null
  website: string | null
  notes: string | null
  submitted_by: string | null
  submitter_email: string | null
  photo_url: string | null
  status: string
  status_display: string
  submitted_at: string
  approved_resort_id: string | null
  potential_matches: PotentialMatch[] | null
  duplicate_submissions: DuplicateSubmission[] | null
}

interface LinkedVisit {
  id: string
  user_id: string
  pending_resort_name: string | null
  start_date: string | null
  entry_type: string
  created_at: string
}

interface VisitProfile {
  id: string
  first_name: string | null
  email: string | null
  avatar_url: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callEdgeFunction(
  functionName: string,
  body: Record<string, unknown>,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

function similarityBadge(score: number) {
  if (score >= 0.8) return { label: 'High', className: 'bg-green-500/15 text-green-400' }
  if (score >= 0.5) return { label: 'Medium', className: 'bg-yellow-500/15 text-yellow-400' }
  return { label: 'Low', className: 'bg-slate-500/15 text-slate-400' }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SubmissionsPage() {
  const { log } = useAuditLog()

  // Data
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [selected, setSelected] = useState<Submission | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Detail panel extras
  const [linkedVisits, setLinkedVisits] = useState<LinkedVisit[]>([])
  const [visitProfiles, setVisitProfiles] = useState<VisitProfile[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // Stats
  const [pendingCount, setPendingCount] = useState(0)
  const [approvedCount, setApprovedCount] = useState(0)
  const [totalResorts, setTotalResorts] = useState(0)

  // Status filter
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending')

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Approve: resort picker
  const [resortSearchQuery, setResortSearchQuery] = useState('')
  const [resortSearchResults, setResortSearchResults] = useState<{ id: string; name: string; country_code: string }[]>([])
  const [resortSearching, setResortSearching] = useState(false)
  const [selectedResortId, setSelectedResortId] = useState<string | null>(null)

  // Process image form (existing workflow)
  const [processImageUrl, setProcessImageUrl] = useState('')
  const [processResortName, setProcessResortName] = useState('')
  const [processLoading, setProcessLoading] = useState(false)

  // Create resort (existing workflow)
  const [createResortJson, setCreateResortJson] = useState('')
  const [createLoading, setCreateLoading] = useState(false)

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadSubmissions = useCallback(async () => {
    try {
      // Use the new edge function for enriched data (pg_trgm matches)
      const [listRes, pendingRes, approvedRes, resortsRes] = await Promise.all([
        callEdgeFunction('admin-list-submissions', { action: 'list', status: statusFilter }),
        supabase
          .from('resort_submissions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase
          .from('resort_submissions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'approved'),
        supabase
          .from('resorts')
          .select('*', { count: 'exact', head: true }),
      ])

      setSubmissions(listRes.submissions ?? [])
      setPendingCount(pendingRes.count ?? 0)
      setApprovedCount(approvedRes.count ?? 0)
      setTotalResorts(resortsRes.count ?? 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load submissions')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [statusFilter])

  useEffect(() => {
    setLoading(true)
    loadSubmissions()
  }, [loadSubmissions])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadSubmissions()
  }, [loadSubmissions])

  // Load detail (linked visits) when selecting a submission
  const loadDetail = useCallback(async (sub: Submission) => {
    setDetailLoading(true)
    try {
      const res = await callEdgeFunction('admin-list-submissions', {
        action: 'detail',
        submissionId: sub.id,
      })
      setLinkedVisits(res.visits ?? [])
      setVisitProfiles(res.profiles ?? [])
    } catch {
      // Non-critical — detail just won't show visits
      setLinkedVisits([])
      setVisitProfiles([])
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const handleSelect = useCallback(
    (sub: Submission) => {
      setSelected(sub)
      setProcessImageUrl(sub.photo_url ?? '')
      setProcessResortName(sub.resort_name)
      setSelectedResortId(null)
      setResortSearchQuery('')
      setResortSearchResults([])
      loadDetail(sub)
    },
    [loadDetail],
  )

  // ---------------------------------------------------------------------------
  // Resort search for approve action
  // ---------------------------------------------------------------------------

  const searchResorts = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResortSearchResults([])
      return
    }
    setResortSearching(true)
    try {
      const { data, error } = await supabase
        .from('resorts')
        .select('id, name, country_code')
        .ilike('name', `%${query}%`)
        .limit(10)

      if (!error) setResortSearchResults(data ?? [])
    } finally {
      setResortSearching(false)
    }
  }, [])

  // Debounced resort search
  useEffect(() => {
    const timer = setTimeout(() => searchResorts(resortSearchQuery), 300)
    return () => clearTimeout(timer)
  }, [resortSearchQuery, searchResorts])

  // ---------------------------------------------------------------------------
  // Actions via edge function
  // ---------------------------------------------------------------------------

  const handleApprove = useCallback(async () => {
    if (!selected) return
    const resortId = selectedResortId
    if (!resortId) {
      toast.error('Pick a resort to link this submission to')
      return
    }
    setActionLoading(true)
    try {
      await callEdgeFunction('admin-manage-submission', {
        action: 'approve',
        submissionId: selected.id,
        resortId,
      })
      toast.success(`Approved: ${selected.resort_name} — cascading to duplicates`)
      setSelected(null)
      setConfirmAction(null)
      loadSubmissions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setActionLoading(false)
    }
  }, [selected, selectedResortId, loadSubmissions])

  const handleReject = useCallback(async () => {
    if (!selected) return
    setActionLoading(true)
    try {
      await callEdgeFunction('admin-manage-submission', {
        action: 'hard_delete',
        submissionId: selected.id,
      })
      toast.success(`Rejected: ${selected.resort_name} — submission and visits removed, user notified`)
      setSelected(null)
      setConfirmAction(null)
      loadSubmissions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setActionLoading(false)
    }
  }, [selected, loadSubmissions])


  // ---------------------------------------------------------------------------
  // Existing workflows: research prompt, process image, create resort
  // ---------------------------------------------------------------------------

  const generateResearchPrompt = useCallback(() => {
    if (!selected) return ''
    return `Research the ski resort "${selected.resort_name}" in ${selected.country}${selected.region ? `, ${selected.region}` : ''}.

Provide the following information in JSON format:
{
  "name": "",
  "country": "",
  "country_code": "",
  "region": "",
  "lat": 0,
  "lng": 0,
  "website": "",
  "vertical_m": 0,
  "runs": 0,
  "lifts": 0,
  "annual_snowfall_cm": 0,
  "beginner_pct": 0,
  "intermediate_pct": 0,
  "advanced_pct": 0,
  "cover_image_url": "",
  "verified": true,
  "pass_affiliation": "",
  "season_open": "",
  "season_close": "",
  "has_night_skiing": false,
  "instagram_handle": "",
  "description": ""
}

Notes from submitter: ${selected.notes ?? 'None'}`
  }, [selected])

  const handleCopyPrompt = useCallback(async () => {
    const prompt = generateResearchPrompt()
    await navigator.clipboard.writeText(prompt)
    toast.success('Research prompt copied to clipboard')
  }, [generateResearchPrompt])

  const handleProcessImage = useCallback(async () => {
    if (!selected) return
    setProcessLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        toast.error('Not authenticated')
        return
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/process-resort-image`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            submission_id: selected.id,
            photo_url: processImageUrl || selected.photo_url,
            resort_name: processResortName || selected.resort_name,
          }),
        },
      )

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'Failed to process image')
      }

      toast.success('Image processed successfully')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to process image')
    } finally {
      setProcessLoading(false)
    }
  }, [selected, processImageUrl, processResortName])

  const handleCreateResort = useCallback(async () => {
    if (!createResortJson.trim()) {
      toast.error('Please paste the JSON data')
      return
    }

    setCreateLoading(true)
    try {
      const parsedData = JSON.parse(createResortJson)
      const { data: insertedResort, error } = await supabase
        .from('resorts')
        .insert(parsedData)
        .select('id')
        .single()

      if (error) {
        toast.error(`Failed to create resort: ${error.message}`)
        return
      }

      await log({
        action: 'create_resort',
        entity_type: 'resort',
        details: { resort_name: parsedData.name, source: 'submission' },
      })

      toast.success(`Resort "${parsedData.name}" created successfully`)

      // Auto-approve the submission linked to the new resort
      if (selected && insertedResort?.id) {
        try {
          await callEdgeFunction('admin-manage-submission', {
            action: 'approve',
            submissionId: selected.id,
            resortId: insertedResort.id,
          })
          toast.success('Submission auto-approved & linked to new resort')
          setSelected(null)
          loadSubmissions()
        } catch {
          toast.error('Resort created but failed to auto-approve submission')
        }
      }

      setCreateResortJson('')
    } catch {
      toast.error('Invalid JSON — please check and try again')
    } finally {
      setCreateLoading(false)
    }
  }, [createResortJson, selected, log, loadSubmissions])

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const profileMap = new Map(visitProfiles.map((p) => [p.id, p]))

  const potentialMatches = selected?.potential_matches ?? []
  const duplicates = selected?.duplicate_submissions ?? []

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Submissions"
        subtitle="Review, approve, or reject resort submissions"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <StatsCard label="Pending" value={pendingCount} />
          <StatsCard label="Approved Total" value={approvedCount} />
          <StatsCard label="Total Resorts" value={totalResorts} />
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-2">
          {(['pending', 'approved', 'rejected'] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s)
                setSelected(null)
              }}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
                statusFilter === s
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'text-muted-foreground border-border hover:border-primary/20',
              )}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s === 'pending' && pendingCount > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Main content: list + details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Submissions List */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold">
                {statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Submissions
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {submissions.length} submissions · oldest first
              </p>
            </div>
            <ScrollArea className="max-h-[600px]">
              {loading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 rounded-lg" />
                  ))}
                </div>
              ) : submissions.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No {statusFilter} submissions
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {submissions.map((sub) => {
                    const hasDupes = (sub.duplicate_submissions?.length ?? 0) > 0
                    const hasMatches = (sub.potential_matches?.length ?? 0) > 0
                    return (
                      <button
                        key={sub.id}
                        onClick={() => handleSelect(sub)}
                        className={cn(
                          'w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors',
                          selected?.id === sub.id && 'bg-accent',
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{sub.resort_name}</div>
                          <div className="flex gap-1">
                            {hasDupes && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400">
                                {sub.duplicate_submissions!.length} dupes
                              </span>
                            )}
                            {hasMatches && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
                                {sub.potential_matches!.length} match{sub.potential_matches!.length !== 1 ? 'es' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {sub.country}
                          {sub.region ? ` · ${sub.region}` : ''}
                          {' · '}
                          {timeAgo(sub.submitted_at)}
                          {sub.submitter_email ? ` · ${sub.submitter_email}` : ''}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Right: Submission Details */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold">Submission Details</h2>
            </div>
            {selected ? (
              <ScrollArea className="max-h-[600px]">
                <div className="p-4 space-y-4">
                  {/* Basic info */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Resort Name</span>
                      <p className="font-medium">{selected.resort_name}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Country</span>
                      <p className="font-medium">{selected.country}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Region</span>
                      <p className="font-medium">{selected.region ?? 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status</span>
                      <p>
                        <Badge variant="secondary">{selected.status_display ?? selected.status}</Badge>
                      </p>
                    </div>
                    {selected.website && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Website</span>
                        <p className="font-medium text-primary truncate">{selected.website}</p>
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Notes</span>
                      <p className="font-medium">{selected.notes ?? 'None'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Submitted</span>
                      <p className="font-medium">{formatDate(selected.submitted_at)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Email</span>
                      <p className="font-medium">{selected.submitter_email ?? 'N/A'}</p>
                    </div>
                  </div>

                  {selected.photo_url && (
                    <div>
                      <span className="text-xs text-muted-foreground">Submitted Photo</span>
                      <img
                        src={selected.photo_url}
                        alt={selected.resort_name}
                        className="mt-1 rounded-lg max-h-48 w-full object-cover"
                      />
                    </div>
                  )}

                  {/* Potential Resort Matches (pg_trgm) */}
                  {potentialMatches.length > 0 && (
                    <div className="border border-blue-500/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Mountain className="w-4 h-4 text-blue-400" />
                        <span className="text-xs font-semibold text-blue-400">
                          Potential Resort Matches
                        </span>
                      </div>
                      <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                        {potentialMatches.map((m) => {
                          const sim = similarityBadge(m.similarity)
                          return (
                            <button
                              key={m.id}
                              onClick={() => setSelectedResortId(m.id)}
                              className={cn(
                                'w-full flex items-center justify-between text-left px-2.5 py-2 rounded-md text-sm transition-colors',
                                selectedResortId === m.id
                                  ? 'bg-primary/10 ring-1 ring-primary/30'
                                  : 'hover:bg-accent/50',
                              )}
                            >
                              <div>
                                <span className="font-medium">{m.name}</span>
                                <span className="text-muted-foreground ml-1.5">{m.country_code}</span>
                              </div>
                              <span className={cn('text-[10px] px-1.5 py-0.5 rounded', sim.className)}>
                                {Math.round(m.similarity * 100)}% {sim.label}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      {selectedResortId && potentialMatches.some((m) => m.id === selectedResortId) && (
                        <p className="text-xs text-green-400 mt-2">
                          <Check className="w-3 h-3 inline mr-1" />
                          Selected for approval — click Approve to link
                        </p>
                      )}
                    </div>
                  )}

                  {/* Duplicate Submissions */}
                  {duplicates.length > 0 && (
                    <div className="border border-orange-500/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Link2 className="w-4 h-4 text-orange-400" />
                        <span className="text-xs font-semibold text-orange-400">
                          Duplicate Submissions ({duplicates.length})
                        </span>
                      </div>
                      <div className="space-y-1 text-sm max-h-[150px] overflow-y-auto">
                        {duplicates.map((d) => (
                          <div
                            key={d.id}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-accent/50"
                          >
                            <span>{d.resort_name} · {d.country}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {Math.round(d.similarity * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Approving this submission will auto-approve exact-match duplicates.
                      </p>
                    </div>
                  )}

                  {/* Linked Visits */}
                  {detailLoading ? (
                    <Skeleton className="h-12 rounded-lg" />
                  ) : linkedVisits.length > 0 ? (
                    <div className="border border-border rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground">
                          Linked Visits ({linkedVisits.length})
                        </span>
                      </div>
                      <div className="space-y-1 text-sm max-h-[150px] overflow-y-auto">
                        {linkedVisits.map((v) => {
                          const profile = profileMap.get(v.user_id)
                          return (
                            <div key={v.id} className="flex items-center justify-between px-2.5 py-1.5">
                              <span>
                                {profile?.first_name ?? profile?.email ?? v.user_id.slice(0, 8)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {v.start_date ? formatDate(v.start_date) : 'No date'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* Action Buttons */}
                  {selected.status === 'pending' && (
                    <div className="space-y-3 pt-2">
                      {/* Resort search for approve (when no potential match available) */}
                      {potentialMatches.length === 0 && (
                        <div>
                          <Label className="text-xs">Search resort to approve to</Label>
                          <div className="relative mt-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              value={resortSearchQuery}
                              onChange={(e) => setResortSearchQuery(e.target.value)}
                              placeholder="Search existing resorts..."
                              className="pl-9"
                            />
                          </div>
                          {resortSearching && (
                            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Searching...
                            </div>
                          )}
                          {resortSearchResults.length > 0 && (
                            <div className="mt-1 border border-border rounded-md divide-y divide-border max-h-40 overflow-auto">
                              {resortSearchResults.map((r) => (
                                <button
                                  key={r.id}
                                  onClick={() => {
                                    setSelectedResortId(r.id)
                                    setResortSearchQuery(r.name)
                                    setResortSearchResults([])
                                  }}
                                  className={cn(
                                    'w-full text-left px-3 py-2 text-sm hover:bg-accent/50',
                                    selectedResortId === r.id && 'bg-primary/10',
                                  )}
                                >
                                  {r.name} <span className="text-muted-foreground">{r.country_code}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {selectedResortId && (
                            <p className="text-xs text-green-400 mt-1">
                              <Check className="w-3 h-3 inline mr-1" />
                              Resort selected — click Approve to link
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button
                          onClick={() => setConfirmAction('approve')}
                          className="flex-1"
                          disabled={!selectedResortId}
                        >
                          <Check className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setConfirmAction('reject')}
                          className="flex-1"
                        >
                          <X className="w-4 h-4 mr-1" />
                          Reject
                        </Button>
                      </div>

                      <div className="text-[11px] text-muted-foreground space-y-0.5">
                        <p><strong>Approve:</strong> Links to resort, backfills visits, cascades to duplicates, notifies user.</p>
                        <p><strong>Reject:</strong> Removes submission and all linked visits/photos. User notified to contact support.</p>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Select a submission to view details
              </div>
            )}
          </div>
        </div>

        {/* Bottom: Processing Section (existing workflow) */}
        {selected && selected.status === 'pending' && (
          <div className="bg-card border border-border rounded-xl p-4">
            <Tabs defaultValue="workflow">
              <TabsList>
                <TabsTrigger value="workflow">Workflow</TabsTrigger>
                <TabsTrigger value="research">Research Prompt</TabsTrigger>
                <TabsTrigger value="image">Process Image</TabsTrigger>
                <TabsTrigger value="create">Create Resort</TabsTrigger>
              </TabsList>

              <TabsContent value="workflow" className="mt-4">
                <div className="space-y-3 text-sm">
                  <h3 className="font-semibold">Submission Review Workflow</h3>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>
                      <strong className="text-foreground">Check matches:</strong> Review the potential resort matches above. If a match exists, select it and click Approve.
                    </li>
                    <li>
                      <strong className="text-foreground">New resort?</strong> Copy the Research Prompt, paste into Claude to get resort data.
                    </li>
                    <li>If the resort has a photo, use Process Image to generate a cover image.</li>
                    <li>Paste Claude's JSON into Create Resort. The submission auto-approves and cascades to duplicates.</li>
                    <li>
                      <strong className="text-foreground">Invalid?</strong> Reject (removes submission and visits; user must start again; notified to contact support).
                    </li>
                  </ol>
                </div>
              </TabsContent>

              <TabsContent value="research" className="mt-4">
                <div className="space-y-3">
                  <div className="bg-muted/50 rounded-lg p-4 text-sm font-mono whitespace-pre-wrap max-h-[300px] overflow-auto">
                    {generateResearchPrompt()}
                  </div>
                  <Button onClick={handleCopyPrompt} variant="outline" size="sm">
                    <Copy className="w-4 h-4 mr-1" />
                    Copy Prompt
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="image" className="mt-4">
                <div className="space-y-3 max-w-md">
                  <div>
                    <Label>Submission ID</Label>
                    <Input value={selected.id} readOnly className="mt-1 font-mono text-xs" />
                  </div>
                  <div>
                    <Label>Photo URL</Label>
                    <Input
                      value={processImageUrl}
                      onChange={(e) => setProcessImageUrl(e.target.value)}
                      placeholder="Photo URL"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Resort Name</Label>
                    <Input
                      value={processResortName}
                      onChange={(e) => setProcessResortName(e.target.value)}
                      placeholder="Resort name"
                      className="mt-1"
                    />
                  </div>
                  <Button onClick={handleProcessImage} disabled={processLoading}>
                    {processLoading ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <ImageIcon className="w-4 h-4 mr-1" />
                    )}
                    Process Image
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="create" className="mt-4">
                <div className="space-y-3">
                  <div>
                    <Label>Paste Claude's JSON Output</Label>
                    <textarea
                      value={createResortJson}
                      onChange={(e) => setCreateResortJson(e.target.value)}
                      placeholder='{"name": "Resort Name", "country": "...", ...}'
                      className="mt-1 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[200px] font-mono"
                    />
                  </div>
                  <Button
                    onClick={handleCreateResort}
                    disabled={createLoading || !createResortJson.trim()}
                  >
                    {createLoading ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 mr-1" />
                    )}
                    Create Resort & Auto-Approve
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {/* Confirm Dialogs */}
      <ConfirmDialog
        open={confirmAction === 'approve'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Approve Submission"
        description={`Approve "${selected?.resort_name}" and link to the selected resort? This will backfill all linked visits and cascade-approve any duplicate submissions.`}
        confirmLabel={actionLoading ? 'Approving...' : 'Approve'}
        onConfirm={handleApprove}
      />
      <ConfirmDialog
        open={confirmAction === 'reject'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Reject Submission"
        description={`Reject "${selected?.resort_name}"? This will permanently remove the submission and all linked visits/photos. The user will be notified to contact support.`}
        confirmLabel={actionLoading ? 'Rejecting...' : 'Reject'}
        variant="destructive"
        onConfirm={handleReject}
      />
    </div>
  )
}

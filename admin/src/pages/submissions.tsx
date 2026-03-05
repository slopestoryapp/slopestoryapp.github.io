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
  CheckCircle2,
  X,
  Copy,
  Loader2,
  ImageIcon,
  Plus,
  Search,
  Users,
  Link2,
  Mountain,
  AlertCircle,
  SkipForward,
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

  // Process image form
  const [processImageUrl, setProcessImageUrl] = useState('')
  const [processResortName, setProcessResortName] = useState('')
  const [processLoading, setProcessLoading] = useState(false)
  const [processedCoverUrl, setProcessedCoverUrl] = useState('')

  // Resort Data (step 3: paste Claude's JSON)
  const [createResortJson, setCreateResortJson] = useState('')
  const [resortData, setResortData] = useState<Record<string, unknown> | null>(null)
  const [resortDataError, setResortDataError] = useState('')

  // Create resort (step 5)
  const [createLoading, setCreateLoading] = useState(false)

  // Placeholders (fetched once for auto-assignment)
  const [placeholderUrls, setPlaceholderUrls] = useState<string[]>([])

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

  // Fetch available placeholder URLs once on mount (for auto-assignment)
  useEffect(() => {
    callEdgeFunction('admin-bulk-import-resorts', { action: 'list_placeholders' })
      .then((res) => setPlaceholderUrls(res.urls ?? []))
      .catch(() => {}) // best-effort
  }, [])

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
      // Reset workflow state for new submission
      setProcessedCoverUrl('')
      setCreateResortJson('')
      setResortData(null)
      setResortDataError('')
      setMissingRequired([])
      setMissingOptional([])
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

## Sources to check (in order of reliability)
1. **Official resort website** — most authoritative for lifts, runs, vertical, season dates
2. **Wikipedia** — good for coordinates, region, general facts
3. **skiresort.info** — comprehensive stats, but "runs" may actually be slope_km
4. **OnTheSnow** — backup source for stats
5. **Google Maps** — for exact base area coordinates

## CRITICAL checks
- **runs ≠ slope_km**: "runs" must be the actual number of distinct ski trails, NOT total slope kilometers. This is the #1 data quality issue. If a source gives e.g. "120 runs" and slope km is ~120, the runs value is almost certainly wrong — look up the actual trail count.
- **has_night_skiing**: Only true if actual night skiing/snowboarding on lit runs exists. Tobogganing, night sledding, and lit walking paths do NOT count.
- **coordinates**: lat/lng must be the base area / main village, not the summit. 6 decimal places. Cross-check with Google Maps.
- **beginner_pct + intermediate_pct + advanced_pct** must sum to 100 (or all null if unknown).
- **Is it real?**: Confirm the resort actually exists and is operational. Flag if fabricated, permanently closed, heli/cat-ski only, indoor, or dry slope.
- **instagram_handle**: DON'T include the @ symbol. Just the handle (e.g. "vaboreal", not "@vaboreal").

## pass_affiliation values
Use the major global pass name if applicable: "Epic Pass", "Ikon Pass", "Mountain Collective", "Indy Pass".
For regional multi-resort passes (common in Europe), use the pass name as-is, e.g. "Portes du Soleil", "Les 3 Vallées", "Ski amadé", "Magic Pass", "Snow Card Tirol".
Use "Independent" if the resort is not part of any multi-resort pass. Use null if unknown.

## budget_tier values
Estimate the typical adult day lift ticket price:
- "budget" — under $60 USD / day
- "mid" — $60–120 / day
- "premium" — $120–200 / day
- "luxury" — $200+ / day

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
  "budget_tier": "",
  "description": "",
  "verification_notes": ""
}

If you find discrepancies between sources or anything uncertain, document them in verification_notes. Use null for any field you truly cannot determine.

Notes from submitter: ${selected.notes ?? 'None'}`
  }, [selected])

  const handleCopyPrompt = useCallback(async () => {
    const prompt = generateResearchPrompt()
    await navigator.clipboard.writeText(prompt)
    toast.success('Research prompt copied to clipboard')
  }, [generateResearchPrompt])

  // Fields expected from Claude's research output, split by DB constraint
  const REQUIRED_FIELDS = ['name', 'country', 'country_code', 'region', 'lat', 'lng'] as const
  const OPTIONAL_FIELDS = [
    'website', 'vertical_m', 'runs', 'lifts', 'annual_snowfall_cm',
    'beginner_pct', 'intermediate_pct', 'advanced_pct',
    'season_open', 'season_close', 'has_night_skiing',
    'pass_affiliation', 'instagram_handle', 'budget_tier', 'description',
  ] as const

  const [missingRequired, setMissingRequired] = useState<string[]>([])
  const [missingOptional, setMissingOptional] = useState<string[]>([])

  const handleParseResortData = useCallback(() => {
    if (!createResortJson.trim()) {
      setResortDataError('Paste Claude\'s JSON output first')
      setResortData(null)
      setMissingRequired([])
      setMissingOptional([])
      return
    }
    try {
      const parsed = JSON.parse(createResortJson)
      if (!parsed.name || !parsed.country) {
        setResortDataError('JSON must include at least "name" and "country"')
        setResortData(null)
        setMissingRequired([])
        setMissingOptional([])
        return
      }

      // Check for null/empty/missing fields
      const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || v === 0
      const reqMissing = REQUIRED_FIELDS.filter((f) => isEmpty(parsed[f]))
      const optMissing = OPTIONAL_FIELDS.filter((f) => isEmpty(parsed[f]))

      setResortData(parsed)
      setResortDataError('')
      setMissingRequired(reqMissing)
      setMissingOptional(optMissing)

      // Auto-fill resort name for Cover Image tab
      if (parsed.name) setProcessResortName(parsed.name)

      if (reqMissing.length > 0) {
        toast.error(`Missing ${reqMissing.length} required field(s) — DB insert will fail`)
      } else if (optMissing.length > 0) {
        toast.warning(`Parsed OK — ${optMissing.length} optional field(s) are empty`)
      } else {
        toast.success(`All fields filled: ${parsed.name} (${parsed.country})`)
      }
    } catch {
      setResortDataError('Invalid JSON — check syntax and try again')
      setResortData(null)
      setMissingRequired([])
      setMissingOptional([])
    }
  }, [createResortJson])

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

      const result = await response.json()
      if (result.url) {
        setProcessedCoverUrl(result.url)
        toast.success(`Cover image processed: ${result.fileName}`)
      } else {
        toast.success('Image processed successfully')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to process image')
    } finally {
      setProcessLoading(false)
    }
  }, [selected, processImageUrl, processResortName])

  const handleCreateResort = useCallback(async () => {
    if (!resortData) {
      toast.error('Go to Resort Data tab first and parse Claude\'s JSON')
      return
    }

    setCreateLoading(true)
    try {
      // Build final data: parsed resort data + cover image resolution
      const finalData = { ...resortData }

      // Remove fields that don't belong in the resorts table
      delete finalData.verification_notes
      delete finalData.status

      // Resolve cover_image_url: processed image > placeholder > leave as-is
      if (!finalData.cover_image_url) {
        if (processedCoverUrl) {
          finalData.cover_image_url = processedCoverUrl
        } else if (placeholderUrls.length > 0) {
          finalData.cover_image_url = placeholderUrls[Math.floor(Math.random() * placeholderUrls.length)]
        }
      }

      const { data: insertedResort, error } = await supabase
        .from('resorts')
        .insert(finalData)
        .select('id')
        .single()

      if (error) {
        toast.error(`Failed to create resort: ${error.message}`)
        return
      }

      await log({
        action: 'create_resort',
        entity_type: 'resort',
        details: {
          resort_name: finalData.name,
          source: 'submission',
          cover_source: processedCoverUrl ? 'processed' : finalData.cover_image_url ? 'placeholder' : 'none',
        },
      })

      toast.success(`Resort "${finalData.name}" created successfully`)

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
      setResortData(null)
      setProcessedCoverUrl('')
    } catch {
      toast.error('Failed to create resort')
    } finally {
      setCreateLoading(false)
    }
  }, [resortData, processedCoverUrl, placeholderUrls, selected, log, loadSubmissions])

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

        {/* Bottom: Processing Section — linear workflow tabs */}
        {selected && selected.status === 'pending' && (
          <div className="bg-card border border-border rounded-xl p-4">
            <Tabs defaultValue="workflow">
              <TabsList>
                <TabsTrigger value="workflow">1. Workflow</TabsTrigger>
                <TabsTrigger value="research">2. Research</TabsTrigger>
                <TabsTrigger value="data">3. Resort Data</TabsTrigger>
                <TabsTrigger value="cover">4. Cover Image</TabsTrigger>
                <TabsTrigger value="create">5. Create Resort</TabsTrigger>
              </TabsList>

              {/* ── Tab 1: Workflow ── */}
              <TabsContent value="workflow" className="mt-4">
                <div className="space-y-3 text-sm">
                  <h3 className="font-semibold">Submission Review Workflow</h3>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>
                      <strong className="text-foreground">Check matches:</strong> Review the potential resort matches above. If a match exists, select it and click Approve.
                    </li>
                    <li>
                      <strong className="text-foreground">Research:</strong> Copy the prompt, paste into Claude to get resort data as JSON.
                    </li>
                    <li>
                      <strong className="text-foreground">Resort Data:</strong> Paste Claude's JSON output and validate it.
                    </li>
                    <li>
                      <strong className="text-foreground">Cover Image:</strong> If you have a photo URL, process it into a cover image. Otherwise skip — a placeholder will be auto-assigned.
                    </li>
                    <li>
                      <strong className="text-foreground">Create Resort:</strong> Review the final data and click Create. The submission auto-approves and cascades to duplicates.
                    </li>
                    <li>
                      <strong className="text-foreground">Invalid?</strong> Reject (removes submission and visits; user notified to contact support).
                    </li>
                  </ol>
                </div>
              </TabsContent>

              {/* ── Tab 2: Research ── */}
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

              {/* ── Tab 3: Resort Data ── */}
              <TabsContent value="data" className="mt-4">
                <div className="space-y-3">
                  <div>
                    <Label>Paste Claude's JSON Output</Label>
                    <textarea
                      value={createResortJson}
                      onChange={(e) => {
                        setCreateResortJson(e.target.value)
                        // Clear previous parse when editing
                        if (resortData) {
                          setResortData(null)
                          setResortDataError('')
                        }
                      }}
                      placeholder='{"name": "Resort Name", "country": "...", ...}'
                      className="mt-1 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[200px] font-mono"
                    />
                  </div>

                  <Button onClick={handleParseResortData} variant="outline" size="sm" disabled={!createResortJson.trim()}>
                    <Check className="w-4 h-4 mr-1" />
                    Parse & Validate
                  </Button>

                  {resortDataError && (
                    <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 rounded-lg p-3">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      {resortDataError}
                    </div>
                  )}

                  {resortData && (
                    <div className={`rounded-lg p-3 space-y-2 border ${
                      missingRequired.length > 0
                        ? 'bg-red-500/10 border-red-500/20'
                        : missingOptional.length > 0
                          ? 'bg-yellow-500/10 border-yellow-500/20'
                          : 'bg-green-500/10 border-green-500/20'
                    }`}>
                      <div className={`flex items-center gap-2 text-sm font-medium ${
                        missingRequired.length > 0
                          ? 'text-red-400'
                          : missingOptional.length > 0
                            ? 'text-yellow-400'
                            : 'text-green-400'
                      }`}>
                        {missingRequired.length > 0 ? (
                          <AlertCircle className="w-4 h-4" />
                        ) : missingOptional.length > 0 ? (
                          <AlertCircle className="w-4 h-4" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        {missingRequired.length > 0
                          ? `${missingRequired.length} required field(s) missing — cannot create`
                          : missingOptional.length > 0
                            ? `Parsed: ${resortData.name as string} — ${missingOptional.length} field(s) empty`
                            : `All fields filled: ${resortData.name as string} (${resortData.country as string})`
                        }
                      </div>

                      <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Region: {(resortData.region as string) || <span className="text-yellow-400">null</span>}</span>
                        <span>Runs: {resortData.runs != null ? String(resortData.runs) : <span className="text-yellow-400">null</span>}</span>
                        <span>Lifts: {resortData.lifts != null ? String(resortData.lifts) : <span className="text-yellow-400">null</span>}</span>
                        <span>Vertical: {resortData.vertical_m != null ? `${resortData.vertical_m}m` : <span className="text-yellow-400">null</span>}</span>
                        <span>Pass: {(resortData.pass_affiliation as string) || <span className="text-yellow-400">null</span>}</span>
                        <span>Budget: {(resortData.budget_tier as string) || <span className="text-yellow-400">null</span>}</span>
                        <span>Night skiing: {resortData.has_night_skiing != null ? (resortData.has_night_skiing ? 'Yes' : 'No') : <span className="text-yellow-400">null</span>}</span>
                        <span>Lat: {resortData.lat != null ? String(resortData.lat) : <span className="text-red-400">null</span>}</span>
                        <span>Lng: {resortData.lng != null ? String(resortData.lng) : <span className="text-red-400">null</span>}</span>
                      </div>

                      {/* Missing required fields — red */}
                      {missingRequired.length > 0 && (
                        <div className="text-xs">
                          <span className="text-red-400 font-medium">Required: </span>
                          <span className="text-red-400">{missingRequired.join(', ')}</span>
                        </div>
                      )}

                      {/* Missing optional fields — yellow */}
                      {missingOptional.length > 0 && (
                        <div className="text-xs">
                          <span className="text-yellow-400 font-medium">Empty: </span>
                          <span className="text-muted-foreground">{missingOptional.join(', ')}</span>
                        </div>
                      )}

                      {!!resortData.cover_image_url && (
                        <p className="text-xs text-muted-foreground">
                          Cover URL in JSON: <span className="font-mono">{String(resortData.cover_image_url).slice(0, 60)}...</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ── Tab 4: Cover Image ── */}
              <TabsContent value="cover" className="mt-4">
                <div className="space-y-4 max-w-md">
                  {!resortData && (
                    <div className="flex items-start gap-2 text-sm text-yellow-400 bg-yellow-500/10 rounded-lg p-3">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      Parse Resort Data first (tab 3) — the resort name will auto-fill here.
                    </div>
                  )}

                  <div>
                    <Label>Photo URL</Label>
                    <Input
                      value={processImageUrl}
                      onChange={(e) => setProcessImageUrl(e.target.value)}
                      placeholder="Paste a photo URL to process into a cover image"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Resort Name</Label>
                    <Input
                      value={processResortName}
                      onChange={(e) => setProcessResortName(e.target.value)}
                      placeholder="Resort name (auto-filled from Resort Data)"
                      className="mt-1"
                      readOnly={!!resortData?.name}
                    />
                    {!!resortData?.name && (
                      <p className="text-xs text-muted-foreground mt-1">Auto-filled from Resort Data</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={handleProcessImage} disabled={processLoading || !processImageUrl.trim()}>
                      {processLoading ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <ImageIcon className="w-4 h-4 mr-1" />
                      )}
                      Process Image
                    </Button>
                  </div>

                  {/* Status: processed image */}
                  {processedCoverUrl && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-green-400">
                        <CheckCircle2 className="w-4 h-4" />
                        Cover image processed
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
                        {processedCoverUrl}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        This will be applied automatically when you Create Resort.
                      </p>
                    </div>
                  )}

                  {/* Status: no image — placeholder info */}
                  {!processedCoverUrl && !String(resortData?.cover_image_url ?? '') && (
                    <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <SkipForward className="w-4 h-4" />
                        <span className="font-medium">No cover image?</span>
                      </div>
                      <p className="mt-1">
                        {placeholderUrls.length > 0
                          ? `A random placeholder will be auto-assigned from ${placeholderUrls.length} available placeholders.`
                          : 'No placeholders available. The resort will be created without a cover image.'
                        }
                      </p>
                    </div>
                  )}

                  {/* Status: JSON already has a cover URL */}
                  {!processedCoverUrl && !!resortData?.cover_image_url && (
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-blue-400">
                        <CheckCircle2 className="w-4 h-4" />
                        Cover URL from Resort Data
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
                        {String(resortData.cover_image_url)}
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ── Tab 5: Create Resort ── */}
              <TabsContent value="create" className="mt-4">
                <div className="space-y-4">
                  {!resortData ? (
                    <div className="flex items-start gap-2 text-sm text-yellow-400 bg-yellow-500/10 rounded-lg p-3">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      Parse Resort Data first (tab 3) before creating.
                    </div>
                  ) : (
                    <>
                      {/* Summary card */}
                      <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                        <h4 className="text-sm font-semibold">
                          {resortData.name as string} — {resortData.country as string}
                        </h4>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                          <span>Region: {(resortData.region as string) || '—'}</span>
                          <span>Website: {(resortData.website as string) || '—'}</span>
                          <span>Runs: {resortData.runs != null ? String(resortData.runs) : '—'}</span>
                          <span>Lifts: {resortData.lifts != null ? String(resortData.lifts) : '—'}</span>
                          <span>Vertical: {resortData.vertical_m != null ? `${resortData.vertical_m}m` : '—'}</span>
                          <span>Budget: {(resortData.budget_tier as string) || '—'}</span>
                        </div>
                        <div className="text-xs mt-2 pt-2 border-t border-border">
                          <span className="text-muted-foreground">Cover image: </span>
                          {processedCoverUrl ? (
                            <span className="text-green-400">Processed image</span>
                          ) : resortData.cover_image_url ? (
                            <span className="text-blue-400">From JSON data</span>
                          ) : placeholderUrls.length > 0 ? (
                            <span className="text-yellow-400">Placeholder (auto-assigned)</span>
                          ) : (
                            <span className="text-red-400">None</span>
                          )}
                        </div>
                      </div>

                      <Button
                        onClick={handleCreateResort}
                        disabled={createLoading}
                        className="w-full"
                      >
                        {createLoading ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Plus className="w-4 h-4 mr-1" />
                        )}
                        Create Resort & Auto-Approve
                      </Button>
                    </>
                  )}
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

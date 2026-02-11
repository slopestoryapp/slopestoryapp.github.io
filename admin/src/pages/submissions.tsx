import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { SUPABASE_URL } from '@/lib/constants'
import { formatDate, cn } from '@/lib/utils'
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
  ExternalLink,
} from 'lucide-react'

interface Submission {
  id: string
  resort_name: string
  country: string
  region: string | null
  notes: string | null
  submitted_by: string | null
  submitter_email: string | null
  photo_url: string | null
  status: string
  submitted_at: string
}

export function SubmissionsPage() {
  const { log } = useAuditLog()

  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [selected, setSelected] = useState<Submission | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Stats
  const [pendingCount, setPendingCount] = useState(0)
  const [approvedCount, setApprovedCount] = useState(0)
  const [totalResorts, setTotalResorts] = useState(0)

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null)

  // Process image form
  const [processImageUrl, setProcessImageUrl] = useState('')
  const [processResortName, setProcessResortName] = useState('')
  const [processLoading, setProcessLoading] = useState(false)

  // Create resort
  const [createResortJson, setCreateResortJson] = useState('')
  const [createLoading, setCreateLoading] = useState(false)

  const loadSubmissions = useCallback(async () => {
    try {
      const [subsRes, pendingRes, approvedRes, resortsRes] = await Promise.all([
        supabase
          .from('resort_submissions')
          .select('*')
          .eq('status', 'pending')
          .order('submitted_at', { ascending: false }),
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

      setSubmissions((subsRes.data as Submission[]) ?? [])
      setPendingCount(pendingRes.count ?? 0)
      setApprovedCount(approvedRes.count ?? 0)
      setTotalResorts(resortsRes.count ?? 0)
    } catch {
      toast.error('Failed to load submissions')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadSubmissions()
  }, [loadSubmissions])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadSubmissions()
  }, [loadSubmissions])

  const handleApprove = useCallback(async () => {
    if (!selected) return
    const { error } = await supabase
      .from('resort_submissions')
      .update({ status: 'approved' })
      .eq('id', selected.id)

    if (error) {
      toast.error('Failed to approve submission')
      return
    }

    await log({
      action: 'approve_submission',
      entity_type: 'resort_submission',
      entity_id: selected.id,
      details: { resort_name: selected.resort_name },
    })

    toast.success(`Approved: ${selected.resort_name}`)
    setSelected(null)
    setConfirmAction(null)
    loadSubmissions()
  }, [selected, log, loadSubmissions])

  const handleReject = useCallback(async () => {
    if (!selected) return
    const { error } = await supabase
      .from('resort_submissions')
      .update({ status: 'rejected' })
      .eq('id', selected.id)

    if (error) {
      toast.error('Failed to reject submission')
      return
    }

    await log({
      action: 'reject_submission',
      entity_type: 'resort_submission',
      entity_id: selected.id,
      details: { resort_name: selected.resort_name },
    })

    toast.success(`Rejected: ${selected.resort_name}`)
    setSelected(null)
    setConfirmAction(null)
    loadSubmissions()
  }, [selected, log, loadSubmissions])

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
        }
      )

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'Failed to process image')
      }

      toast.success('Image processed successfully')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to process image'
      )
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
      const { error } = await supabase.from('resorts').insert(parsedData)

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

      // Offer to auto-approve the submission
      if (selected) {
        const { error: approveErr } = await supabase
          .from('resort_submissions')
          .update({ status: 'approved' })
          .eq('id', selected.id)

        if (!approveErr) {
          await log({
            action: 'auto_approve_submission',
            entity_type: 'resort_submission',
            entity_id: selected.id,
            details: { resort_name: selected.resort_name },
          })
          toast.success('Submission auto-approved')
          setSelected(null)
          loadSubmissions()
        }
      }

      setCreateResortJson('')
    } catch {
      toast.error('Invalid JSON — please check and try again')
    } finally {
      setCreateLoading(false)
    }
  }, [createResortJson, selected, log, loadSubmissions])

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Submissions"
        subtitle="Review and process resort submissions"
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

        {/* Main content: list + details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Pending Submissions List */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold">Pending Submissions</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {pendingCount} submissions awaiting review
              </p>
            </div>
            <ScrollArea className="max-h-[500px]">
              {loading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 rounded-lg" />
                  ))}
                </div>
              ) : submissions.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No pending submissions
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {submissions.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => {
                        setSelected(sub)
                        setProcessImageUrl(sub.photo_url ?? '')
                        setProcessResortName(sub.resort_name)
                      }}
                      className={cn(
                        'w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors',
                        selected?.id === sub.id && 'bg-accent'
                      )}
                    >
                      <div className="text-sm font-medium">{sub.resort_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {sub.country} &middot; {formatDate(sub.submitted_at)}
                      </div>
                    </button>
                  ))}
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
              <div className="p-4 space-y-4">
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
                      <Badge variant="secondary">{selected.status}</Badge>
                    </p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Notes</span>
                    <p className="font-medium">{selected.notes ?? 'None'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Submitted By</span>
                    <p className="font-medium">{selected.submitted_by ?? 'Unknown'}</p>
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

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => setConfirmAction('approve')}
                    className="flex-1"
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Approve
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setConfirmAction('reject')}
                    className="flex-1"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Select a submission to view details
              </div>
            )}
          </div>
        </div>

        {/* Bottom: Processing Section */}
        {selected && (
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
                    <li>Review the submission details and photo above.</li>
                    <li>Copy the Research Prompt and paste into Claude to get resort data.</li>
                    <li>If the resort has a photo, use Process Image to generate a cover image.</li>
                    <li>Paste Claude's JSON output into the Create Resort tab and create the resort.</li>
                    <li>The submission will be auto-approved once the resort is created.</li>
                    <li>If the submission is invalid, click Reject with a reason.</li>
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
                  <Button
                    onClick={handleProcessImage}
                    disabled={processLoading}
                  >
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
                    Create Resort
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
        description={`Are you sure you want to approve "${selected?.resort_name}"?`}
        confirmLabel="Approve"
        onConfirm={handleApprove}
      />
      <ConfirmDialog
        open={confirmAction === 'reject'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Reject Submission"
        description={`Are you sure you want to reject "${selected?.resort_name}"? This cannot be undone.`}
        confirmLabel="Reject"
        variant="destructive"
        onConfirm={handleReject}
      />
    </div>
  )
}

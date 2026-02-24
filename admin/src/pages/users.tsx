import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { PAGE_SIZE } from '@/lib/constants'
import { formatDate, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuditLog } from '@/hooks/use-audit-log'
import { Header } from '@/components/layout/header'
import { ExportButton } from '@/components/shared/export-button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DataTable } from '@/components/shared/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { type ColumnDef } from '@tanstack/react-table'
import {
  Search,
  Loader2,
  Save,
  Trash2,
  Star,
  ImageIcon,
  Heart,
  X,
} from 'lucide-react'

interface Profile {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  username: string | null
  avatar_url: string | null
  units: string | null
  home_resort_id: string | null
  country: string | null
  country_code: string | null
  ski_experience: string | null
  sport_preference: string | null
  seasons_count: number | null
  onboarding_completed: boolean
  created_at: string
}

interface Visit {
  id: string
  resort_id: string
  start_date: string | null
  rating_terrain: number | null
  rating_facilities: number | null
  rating_service: number | null
  resorts: { name: string } | null
}

interface Photo {
  id: string
  photo_url: string
  visit_id: string
}

interface WishlistItem {
  id: string
  resort_id: string
  resorts: { name: string } | null
}

const columns: ColumnDef<Profile, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    accessorFn: (row) =>
      [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unnamed',
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue() as string}</span>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => (
      <span className="text-xs">{row.original.email ?? '-'}</span>
    ),
  },
  {
    accessorKey: 'username',
    header: 'Username',
    cell: ({ row }) => row.original.username ?? '-',
  },
  {
    accessorKey: 'country',
    header: 'Country',
    cell: ({ row }) => row.original.country ?? '-',
  },
  {
    accessorKey: 'ski_experience',
    header: 'Experience',
    cell: ({ row }) => row.original.ski_experience ?? '-',
  },
  {
    accessorKey: 'onboarding_completed',
    header: 'Onboarding',
    cell: ({ row }) =>
      row.original.onboarding_completed ? (
        <Badge className="bg-green-500/20 text-green-400 border-0">
          Done
        </Badge>
      ) : (
        <Badge variant="secondary">Incomplete</Badge>
      ),
  },
]

export function UsersPage() {
  const { log } = useAuditLog()

  const [users, setUsers] = useState<Profile[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')

  // Selected user
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null)
  const [editForm, setEditForm] = useState<Partial<Profile>>({})
  const [saving, setSaving] = useState(false)

  // Delete
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Activity tabs data
  const [visits, setVisits] = useState<Visit[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [wishlist, setWishlist] = useState<WishlistItem[]>([])
  const [activityLoading, setActivityLoading] = useState(false)

  const loadUsers = useCallback(async () => {
    try {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      let query = supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to)

      if (search.trim()) {
        query = query.or(
          `first_name.ilike.%${search.trim()}%,last_name.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%,username.ilike.%${search.trim()}%`
        )
      }

      let countQuery = supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })

      if (search.trim()) {
        countQuery = countQuery.or(
          `first_name.ilike.%${search.trim()}%,last_name.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%,username.ilike.%${search.trim()}%`
        )
      }

      const [dataRes, countRes] = await Promise.all([query, countQuery])

      setUsers((dataRes.data as Profile[]) ?? [])
      setTotalCount(countRes.count ?? 0)
    } catch {
      toast.error('Failed to load users')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [page, search])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadUsers()
  }, [loadUsers])

  const handleSearchSubmit = useCallback(() => {
    setPage(0)
    setLoading(true)
    loadUsers()
  }, [loadUsers])

  const selectUser = useCallback(async (user: Profile) => {
    setSelectedUser(user)
    setEditForm({ ...user })
    setActivityLoading(true)

    try {
      // Load visits
      const { data: visitsData } = await supabase
        .from('user_visits')
        .select('id, resort_id, start_date, rating_terrain, rating_facilities, rating_service, resorts(name)')
        .eq('user_id', user.id)
        .order('start_date', { ascending: false })

      const loadedVisits = (visitsData as unknown as Visit[]) ?? []
      setVisits(loadedVisits)

      // Load photos from user's visits
      if (loadedVisits.length > 0) {
        const visitIds = loadedVisits.map((v) => v.id)
        const { data: photosData } = await supabase
          .from('user_photos')
          .select('id, photo_url, visit_id')
          .in('visit_id', visitIds)
          .limit(50)

        setPhotos((photosData as Photo[]) ?? [])
      } else {
        setPhotos([])
      }

      // Load wishlist
      const { data: wishlistData } = await supabase
        .from('wishlists')
        .select('id, resort_id, resorts(name)')
        .eq('user_id', user.id)

      setWishlist((wishlistData as unknown as WishlistItem[]) ?? [])
    } catch {
      toast.error('Failed to load user activity')
    } finally {
      setActivityLoading(false)
    }
  }, [])

  const updateField = useCallback(
    (field: keyof Profile, value: string | number | boolean | null) => {
      setEditForm((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const handleSave = useCallback(async () => {
    if (!selectedUser) return
    setSaving(true)

    const {
      id: _id,
      created_at: _createdAt,
      ...payload
    } = editForm as Profile

    const { error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', selectedUser.id)

    if (error) {
      toast.error(`Failed to save: ${error.message}`)
      setSaving(false)
      return
    }

    await log({
      action: 'update_profile',
      entity_type: 'profile',
      entity_id: selectedUser.id,
      details: {
        name: `${editForm.first_name ?? ''} ${editForm.last_name ?? ''}`.trim(),
      },
    })

    toast.success('Profile saved')
    setSaving(false)
    loadUsers()
  }, [selectedUser, editForm, log, loadUsers])

  const handleDelete = useCallback(async () => {
    if (!selectedUser) return
    setDeleting(true)

    const { error } = await supabase.functions.invoke('admin-delete-user', {
      body: { userId: selectedUser.id },
    })

    if (error) {
      toast.error(`Failed to delete user: ${error.message}`)
      setDeleting(false)
      return
    }

    await log({
      action: 'delete_user',
      entity_type: 'profile',
      entity_id: selectedUser.id,
      details: {
        email: selectedUser.email,
        name: `${selectedUser.first_name ?? ''} ${selectedUser.last_name ?? ''}`.trim(),
      },
    })

    toast.success('User deleted')
    setDeleting(false)
    setDeleteConfirmOpen(false)
    setSelectedUser(null)
    loadUsers()
  }, [selectedUser, log, loadUsers])

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Users"
        subtitle="Manage user profiles and activity"
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleSearchSubmit}>
            Search
          </Button>
          <ExportButton
            data={users as unknown as Record<string, unknown>[]}
            filename="users"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Data Table (2 cols wide) */}
          <div className="lg:col-span-2">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
              </div>
            ) : (
              <DataTable
                columns={columns}
                data={users}
                onRowClick={selectUser}
                pageSize={PAGE_SIZE}
                serverPagination={{
                  totalCount,
                  page,
                  onPageChange: (p) => {
                    setPage(p)
                    setLoading(true)
                  },
                }}
              />
            )}
          </div>

          {/* Right: User Detail Panel */}
          <div className="bg-card border border-border rounded-xl">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold">User Details</h2>
            </div>

            {selectedUser ? (
              <ScrollArea className="max-h-[calc(100vh-280px)]">
                <div className="p-4 space-y-4">
                  {/* Profile Fields */}
                  <div className="space-y-3">
                    {([
                      ['first_name', 'First Name'],
                      ['last_name', 'Last Name'],
                      ['username', 'Username'],
                      ['email', 'Email'],
                      ['avatar_url', 'Avatar URL'],
                      ['country', 'Country'],
                      ['country_code', 'Country Code'],
                      ['home_resort_id', 'Home Resort ID'],
                    ] as [keyof Profile, string][]).map(([field, label]) => (
                      <div key={field}>
                        <Label className="text-xs">{label}</Label>
                        <Input
                          value={(editForm[field] as string) ?? ''}
                          onChange={(e) =>
                            updateField(field, e.target.value || null)
                          }
                          className="mt-1"
                        />
                      </div>
                    ))}

                    <div>
                      <Label className="text-xs">Units</Label>
                      <Select
                        value={editForm.units ?? 'metric'}
                        onValueChange={(v) => updateField('units', v)}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="metric">Metric</SelectItem>
                          <SelectItem value="imperial">Imperial</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs">Ski Experience</Label>
                      <Select
                        value={editForm.ski_experience ?? ''}
                        onValueChange={(v) =>
                          updateField('ski_experience', v || null)
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="beginner">Beginner</SelectItem>
                          <SelectItem value="intermediate">
                            Intermediate
                          </SelectItem>
                          <SelectItem value="advanced">Advanced</SelectItem>
                          <SelectItem value="expert">Expert</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs">Sport Preference</Label>
                      <Select
                        value={editForm.sport_preference ?? ''}
                        onValueChange={(v) =>
                          updateField('sport_preference', v || null)
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ski">Ski</SelectItem>
                          <SelectItem value="snowboard">Snowboard</SelectItem>
                          <SelectItem value="both">Both</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs">Seasons Count</Label>
                      <Input
                        type="number"
                        value={editForm.seasons_count ?? ''}
                        onChange={(e) =>
                          updateField(
                            'seasons_count',
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label className="text-xs">Onboarding Completed</Label>
                      <Select
                        value={editForm.onboarding_completed ? 'true' : 'false'}
                        onValueChange={(v) =>
                          updateField('onboarding_completed', v === 'true')
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">Yes</SelectItem>
                          <SelectItem value="false">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex-1"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-1" />
                      )}
                      Save
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Activity Tabs */}
                  <div className="border-t border-border pt-4">
                    <Tabs defaultValue="visits">
                      <TabsList className="w-full">
                        <TabsTrigger value="visits" className="flex-1">
                          <Star className="w-3 h-3 mr-1" />
                          Visits
                        </TabsTrigger>
                        <TabsTrigger value="photos" className="flex-1">
                          <ImageIcon className="w-3 h-3 mr-1" />
                          Photos
                        </TabsTrigger>
                        <TabsTrigger value="wishlist" className="flex-1">
                          <Heart className="w-3 h-3 mr-1" />
                          Wishlist
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="visits">
                        {activityLoading ? (
                          <div className="space-y-2 mt-2">
                            {Array.from({ length: 3 }).map((_, i) => (
                              <Skeleton key={i} className="h-10 rounded-lg" />
                            ))}
                          </div>
                        ) : visits.length === 0 ? (
                          <p className="text-sm text-muted-foreground mt-3">
                            No visits recorded
                          </p>
                        ) : (
                          <div className="divide-y divide-border mt-2">
                            {visits.map((v) => (
                              <div
                                key={v.id}
                                className="py-2 flex items-center justify-between"
                              >
                                <div>
                                  <div className="text-sm font-medium">
                                    {v.resorts?.name ?? 'Unknown Resort'}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatDate(v.start_date)}
                                  </div>
                                </div>
                                {v.rating_terrain != null && (
                                  <Badge variant="secondary">
                                    {v.rating_terrain}/5
                                  </Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="photos">
                        {activityLoading ? (
                          <div className="grid grid-cols-3 gap-2 mt-2">
                            {Array.from({ length: 6 }).map((_, i) => (
                              <Skeleton
                                key={i}
                                className="aspect-square rounded-lg"
                              />
                            ))}
                          </div>
                        ) : photos.length === 0 ? (
                          <p className="text-sm text-muted-foreground mt-3">
                            No photos
                          </p>
                        ) : (
                          <div className="grid grid-cols-3 gap-2 mt-2">
                            {photos.map((p) => (
                              <img
                                key={p.id}
                                src={p.photo_url}
                                alt="User photo"
                                className="aspect-square rounded-lg object-cover"
                              />
                            ))}
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="wishlist">
                        {activityLoading ? (
                          <div className="space-y-2 mt-2">
                            {Array.from({ length: 3 }).map((_, i) => (
                              <Skeleton key={i} className="h-8 rounded-lg" />
                            ))}
                          </div>
                        ) : wishlist.length === 0 ? (
                          <p className="text-sm text-muted-foreground mt-3">
                            No wishlist items
                          </p>
                        ) : (
                          <div className="divide-y divide-border mt-2">
                            {wishlist.map((w) => (
                              <div key={w.id} className="py-2">
                                <div className="text-sm font-medium">
                                  {w.resorts?.name ?? 'Unknown Resort'}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Select a user to view details
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete User"
        description={`Are you sure you want to permanently delete this user? This will cascade and delete all their visits, photos, wishlists, and other data. This cannot be undone.`}
        confirmLabel="Delete User"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}

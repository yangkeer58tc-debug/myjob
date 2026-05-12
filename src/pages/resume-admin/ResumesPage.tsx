import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import TopBar from '@/components/resume-admin/TopBar'
import StatusBadge from '@/components/resume-admin/StatusBadge'
import { deleteResumes, listResumes, reparseResume, updateResume } from '@/modules/resumes/rmcApi'
import { cn } from '@/lib/utils'
import type { ResumeListItem } from '@/modules/resumes/rmcTypes'

export default function ResumesPage() {
  const [items, setItems] = useState<ResumeListItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [country, setCountry] = useState('')
  const [status, setStatus] = useState('')
  const [draftNote, setDraftNote] = useState<Record<string, string>>({})
  const [draftDirection, setDraftDirection] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected])
  const [reparsing, setReparsing] = useState(false)
  const [reparseDone, setReparseDone] = useState(0)
  const [reparseTotal, setReparseTotal] = useState(0)

  const params = useMemo(
    () => ({ q, country, status }),
    [q, country, status],
  )

  const load = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const data = await listResumes(params)
      setItems(data.items)
      setSelected({})
      setDraftNote((prev) => {
        const next = { ...prev }
        for (const it of data.items) {
          if (typeof next[it.id] !== 'string') next[it.id] = it.admin_note || ''
        }
        return next
      })
      setDraftDirection((prev) => {
        const next = { ...prev }
        for (const it of data.items) {
          if (typeof next[it.id] !== 'string') next[it.id] = it.job_direction || ''
        }
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load resumes')
    } finally {
      setBusy(false)
    }
  }, [params])

  const save = useCallback(
    async (id: string, patch: Partial<ResumeListItem>) => {
      setSaving((s) => ({ ...s, [id]: true }))
      try {
        const res = await updateResume(id, patch as any)
        setItems((items) => items.map((it) => (it.id === id ? (res.item as any) : it)))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save changes')
      } finally {
        setSaving((s) => ({ ...s, [id]: false }))
      }
    },
    [setItems],
  )

  const toggleAll = useCallback(
    (checked: boolean) => {
      if (!checked) {
        setSelected({})
        return
      }
      const next: Record<string, boolean> = {}
      for (const it of items) next[it.id] = true
      setSelected(next)
    },
    [items],
  )

  const bulkDelete = useCallback(async () => {
    const ids = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k)
    if (!ids.length) return
    const ok = window.confirm(`Delete ${ids.length} selected resume(s)? This action cannot be undone.`)
    if (!ok) return
    setError(null)
    setBusy(true)
    try {
      await deleteResumes(ids)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete resumes')
    } finally {
      setBusy(false)
    }
  }, [selected, load])

  const bulkReparse = useCallback(
    async (mode: 'selected' | 'all') => {
      const ids =
        mode === 'all'
          ? items.map((x) => x.id)
          : Object.entries(selected)
              .filter(([, v]) => v)
              .map(([k]) => k)
      if (!ids.length) return
      const ok = window.confirm(`Re-parse ${ids.length} resume(s)? This may take a while, so keep the page open.`)
      if (!ok) return
      setError(null)
      setReparsing(true)
      setReparseDone(0)
      setReparseTotal(ids.length)
      try {
        for (let i = 0; i < ids.length; i++) {
          await reparseResume(ids[i] as string)
          setReparseDone(i + 1)
        }
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to re-parse resumes')
      } finally {
        setReparsing(false)
      }
    },
    [items, selected, load],
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">Resume List</h1>
            <p className="mt-1 text-sm text-zinc-600">Filter by name, country, and status.</p>
          </div>
          <button
            type="button"
            onClick={load}
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-colors',
              busy ? 'bg-zinc-200 text-zinc-500' : 'bg-zinc-900 text-white hover:bg-zinc-800',
            )}
            disabled={busy}
          >
            {busy ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name / Email / Phone / WhatsApp"
              className="md:col-span-2 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
            />
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Country"
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">All statuses</option>
                <option value="processing">Processing</option>
                <option value="success">Imported</option>
                <option value="failed">Failed</option>
              </select>
              <button
                type="button"
                onClick={load}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                disabled={busy}
              >
                Apply Filters
              </button>
              <button
                type="button"
                onClick={() => {
                  setQ('')
                  setCountry('')
                  setStatus('')
                }}
                className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200"
              >
                Reset
              </button>
            </div>
            <div className="text-xs text-zinc-500">Showing up to 200 rows</div>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-zinc-600">{selectedCount} selected</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void bulkReparse('selected')}
              disabled={reparsing || selectedCount === 0}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                reparsing || selectedCount === 0
                  ? 'bg-zinc-200 text-zinc-500'
                  : 'bg-blue-600 text-white hover:bg-blue-700',
              )}
            >
              Re-parse Selected
            </button>
            <button
              type="button"
              onClick={() => void bulkReparse('all')}
              disabled={reparsing || items.length === 0}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                reparsing || items.length === 0
                  ? 'bg-zinc-200 text-zinc-500'
                  : 'bg-zinc-900 text-white hover:bg-zinc-800',
              )}
            >
              Re-parse All
            </button>
            <button
              type="button"
              onClick={() => void bulkDelete()}
              disabled={busy || reparsing || selectedCount === 0}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                busy || reparsing || selectedCount === 0
                  ? 'bg-zinc-200 text-zinc-500'
                  : 'bg-red-600 text-white hover:bg-red-700',
              )}
            >
              Delete Selected
            </button>
          </div>
        </div>

        {reparsing ? (
          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
            Re-parsing... {reparseDone}/{reparseTotal}
          </div>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="grid grid-cols-12 gap-0 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-700">
            <div className="col-span-1">
              <input
                type="checkbox"
                checked={items.length > 0 && selectedCount === items.length}
                onChange={(e) => toggleAll(e.target.checked)}
              />
            </div>
            <div className="col-span-2">Name</div>
            <div className="col-span-1">Country</div>
            <div className="col-span-2">Contact</div>
            <div className="col-span-2">Direction</div>
            <div className="col-span-2">Note</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>
          {items.length ? (
            items.map((it) => (
              <div
                key={it.id}
                className="grid grid-cols-12 gap-0 border-b border-zinc-100 px-4 py-3 text-sm text-zinc-800 last:border-b-0"
              >
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={!!selected[it.id]}
                    onChange={(e) => setSelected((s) => ({ ...s, [it.id]: e.target.checked }))}
                  />
                </div>
                <div className="col-span-2 truncate font-medium text-zinc-900">
                  {it.name || [it.first_name, it.last_name].filter(Boolean).join(' ') || 'Untitled'}
                </div>
                <div className="col-span-1 truncate text-zinc-700">{it.country || '-'}</div>
                <div className="col-span-2">
                  <div className="flex items-center gap-1">
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                        it.email ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-400',
                      )}
                    >
                      Email
                    </span>
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                        it.whatsapp ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-400',
                      )}
                    >
                      WA
                    </span>
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                        it.phone ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-400',
                      )}
                    >
                      Phone
                    </span>
                  </div>
                </div>
                <div className="col-span-2">
                  <input
                    value={draftDirection[it.id] ?? ''}
                    onChange={(e) => setDraftDirection((d) => ({ ...d, [it.id]: e.target.value.slice(0, 60) }))}
                    onBlur={() => void save(it.id, { job_direction: (draftDirection[it.id] || '').trim() || null })}
                    className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    value={draftNote[it.id] ?? ''}
                    onChange={(e) => setDraftNote((d) => ({ ...d, [it.id]: e.target.value.slice(0, 20) }))}
                    onBlur={() => void save(it.id, { admin_note: (draftNote[it.id] || '').trim() || null })}
                    maxLength={20}
                    className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
                  />
                </div>
                <div className="col-span-1 flex items-center justify-between gap-2">
                  <StatusBadge status={it.parse_status} />
                  {saving[it.id] ? <span className="text-xs text-zinc-400">…</span> : null}
                </div>
                <div className="col-span-1 text-right">
                  <Link
                    to={`/admin/resumes/${it.id}`}
                    className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-800"
                  >
                    View
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-10 text-center text-sm text-zinc-600">
              No resumes yet. Add one from the Import page.
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

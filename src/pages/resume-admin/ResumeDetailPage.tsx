import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import TopBar from '@/components/resume-admin/TopBar'
import BasicInfoCard from '@/components/resume-admin/BasicInfoCard'
import ContactCard from '@/components/resume-admin/ContactCard'
import EducationEditor from '@/components/resume-admin/EducationEditor'
import IntroSummaryCard from '@/components/resume-admin/IntroSummaryCard'
import SourceCard from '@/components/resume-admin/SourceCard'
import { getResume, reparseResume, updateResume } from '@/modules/resumes/rmcApi'
import { cn } from '@/lib/utils'
import type { EducationItem, ResumeDetail } from '@/modules/resumes/rmcTypes'

export default function ResumeDetailPage() {
  const { id } = useParams()
  const [item, setItem] = useState<ResumeDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState<Partial<ResumeDetail>>({})

  const effective = useMemo(() => {
    return { ...item, ...draft } as ResumeDetail | null
  }, [item, draft])

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    setBusy(true)
    try {
      const data = await getResume(id)
      setItem(data.item)
      setDraft({})
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setBusy(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!item) return
    if (item.parse_status !== 'processing') return
    const t = setInterval(() => {
      void load()
    }, 2000)
    return () => clearInterval(t)
  }, [item, load])

  async function save() {
    if (!id) return
    setSaving(true)
    setError(null)
    try {
      const data = await updateResume(id, draft)
      setItem(data.item)
      setDraft({})
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function doReparse() {
    if (!id) return
    setError(null)
    setBusy(true)
    try {
      await reparseResume(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '重解析失败')
    } finally {
      setBusy(false)
    }
  }

  function setField<K extends keyof ResumeDetail>(key: K, value: ResumeDetail[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  const edu = (effective?.education || []) as EducationItem[]

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-zinc-500">
              <Link to="/admin/resumes" className="hover:underline">
                简历列表
              </Link>{' '}
              / 简历详情
            </div>
            <h1 className="mt-1 text-lg font-semibold text-zinc-900">
              {item?.name || [item?.first_name, item?.last_name].filter(Boolean).join(' ') || '简历详情'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              disabled={busy}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                busy ? 'bg-zinc-200 text-zinc-500' : 'bg-zinc-900 text-white hover:bg-zinc-800',
              )}
            >
              {busy ? '刷新中…' : '刷新'}
            </button>
            <button
              type="button"
              onClick={doReparse}
              disabled={busy}
              className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200"
            >
              重解析
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !Object.keys(draft).length}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium text-white transition-colors',
                saving || !Object.keys(draft).length
                  ? 'bg-zinc-300'
                  : 'bg-blue-600 hover:bg-blue-700',
              )}
            >
              {saving ? '保存中…' : '保存修改'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {!item ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
            {busy ? '加载中…' : '未找到该简历'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              {effective ? (
                <>
                  <BasicInfoCard item={item} effective={effective} setField={setField} />
                  <ContactCard effective={effective} setField={setField} />
                  <EducationEditor
                    education={edu}
                    setEducation={(v) => setField('education', v as unknown as ResumeDetail['education'])}
                  />
                  <IntroSummaryCard item={item} effective={effective} setField={setField} />
                </>
              ) : null}
            </div>
            <div className="space-y-4">
              <SourceCard item={item} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

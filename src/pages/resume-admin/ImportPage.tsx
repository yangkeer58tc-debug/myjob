import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '@/components/resume-admin/TopBar'
import { importResumeBatch, importResumeUpload, importResumeUrl } from '@/modules/resumes/rmcApi'
import { cn } from '@/lib/utils'

type Tab = 'upload' | 'url' | 'batch'

export default function ImportPage() {
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [batchFile, setBatchFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [batchResult, setBatchResult] = useState<string | null>(null)

  const canSubmit = useMemo(() => {
    if (busy) return false
    if (tab === 'upload') return files.length > 0
    if (tab === 'batch') return !!batchFile
    return !!url.trim()
  }, [busy, tab, files, batchFile, url])

  async function onSubmit() {
    setError(null)
    setProgress(null)
    setBatchResult(null)
    setBusy(true)
    try {
      if (tab === 'upload') {
        for (let i = 0; i < files.length; i++) {
          const f = files[i] as File
          await importResumeUpload(f, {
            onProgress: (msg) => setProgress(`(${i + 1}/${files.length}) ${f.name} · ${msg}`),
          })
        }
        nav('/admin/resumes')
      } else if (tab === 'batch') {
        if (!batchFile) throw new Error('Please choose an Excel/CSV file first.')
        const result = await importResumeBatch(batchFile, { onProgress: setProgress })
        setBatchResult(`Batch import complete: ${result.success}/${result.total} succeeded, ${result.failed} failed.`)
        if (result.errors.length) setError(result.errors.slice(0, 5).join('\n'))
        nav('/admin/resumes')
      } else {
        const data = await importResumeUrl(url.trim(), { onProgress: setProgress })
        nav(`/admin/resumes/${data.resumeId}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900">Import Resumes</h1>
          <p className="mt-1 text-sm text-zinc-600">Upload files or provide a file URL to import, parse, and store resumes automatically.</p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('upload')}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                tab === 'upload'
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
              )}
            >
              Upload Files
            </button>
            <button
              type="button"
              onClick={() => setTab('batch')}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                tab === 'batch'
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
              )}
            >
              Excel/CSV Batch
            </button>
            <button
              type="button"
              onClick={() => setTab('url')}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                tab === 'url'
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
              )}
            >
              File URL
            </button>
          </div>

          <div className="mt-4">
            {tab === 'upload' ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-800">Choose files (PDF / DOCX / TXT, multiple allowed)</label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/png,image/jpeg"
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
                {files.length ? (
                  <div className="text-xs text-zinc-600">{files.length} file(s) selected</div>
                ) : null}
              </div>
            ) : tab === 'batch' ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-800">Choose a batch file (CSV / TSV / TXT)</label>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,.xls,.xlsx"
                  onChange={(e) => setBatchFile((e.target.files || [])[0] || null)}
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
                <div className="text-xs text-zinc-600">
                  Supports MyJob-standardized table fields, including JSON columns. For Excel, prefer “Save As CSV (UTF-8)” before uploading.
                </div>
                {batchFile ? <div className="text-xs text-zinc-600">Selected: {batchFile.name}</div> : null}
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-800">File URL (public direct link)</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/resume.pdf"
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
                <div className="text-xs text-zinc-600">Only http/https is supported. Max file size is 15MB. On Cloudflare Pages, the site proxy will be used to bypass CORS when downloading.</div>
              </div>
            )}
          </div>

          {error ? (
            <div className="mt-4 whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          {progress ? (
            <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
              {progress}
            </div>
          ) : null}
          {batchResult ? (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {batchResult}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-zinc-500">After import, you will be taken to the detail page where fields can be corrected manually.</div>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
                canSubmit ? 'bg-blue-600 hover:bg-blue-700' : 'bg-zinc-300',
              )}
            >
              {busy ? 'Importing...' : 'Start Import'}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Parsing Notes</h2>
          <ul className="mt-2 space-y-1 text-sm text-zinc-600">
            <li>Field extraction relies on local parsing and rule matching without paid APIs.</li>
            <li>The profile summary is extractive and stays in the original language without translation.</li>
            <li>If parsing is inaccurate, fields can be edited and saved on the detail page.</li>
            <li>If you configure a Poe/OpenAI-compatible gateway, the system can additionally use AI to correct and enrich fields.</li>
            <li>Batch import supports standardized table fields and shows row-by-row progress and failure feedback.</li>
          </ul>
        </div>
      </main>
    </div>
  )
}

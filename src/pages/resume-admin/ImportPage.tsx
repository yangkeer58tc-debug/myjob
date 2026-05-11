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
        if (!batchFile) throw new Error('请先选择 Excel/CSV 文件')
        const result = await importResumeBatch(batchFile, { onProgress: setProgress })
        setBatchResult(`批量导入完成：成功 ${result.success}/${result.total}，失败 ${result.failed}`)
        if (result.errors.length) setError(result.errors.slice(0, 5).join('\n'))
        nav('/admin/resumes')
      } else {
        const data = await importResumeUrl(url.trim(), { onProgress: setProgress })
        nav(`/admin/resumes/${data.resumeId}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-zinc-900">导入简历</h1>
          <p className="mt-1 text-sm text-zinc-600">支持上传文件或输入文件链接导入，自动解析并入库。</p>
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
              手动上传
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
              Excel/CSV 批量
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
              文件链接
            </button>
          </div>

          <div className="mt-4">
            {tab === 'upload' ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-800">选择文件（PDF / DOCX / TXT，可多选）</label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/png,image/jpeg"
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
                {files.length ? (
                  <div className="text-xs text-zinc-600">已选择 {files.length} 个文件</div>
                ) : null}
              </div>
            ) : tab === 'batch' ? (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-800">选择批量文件（CSV / TSV / TXT）</label>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,.xls,.xlsx"
                  onChange={(e) => setBatchFile((e.target.files || [])[0] || null)}
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
                <div className="text-xs text-zinc-600">
                  支持 MyJob 标准化表格字段（含 JSON 列）。Excel 请优先“另存为 CSV（UTF-8）”后上传。
                </div>
                {batchFile ? <div className="text-xs text-zinc-600">已选择：{batchFile.name}</div> : null}
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-800">文件链接（可公开访问的直链）</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/resume.pdf"
                  className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
                <div className="text-xs text-zinc-600">仅支持 http/https，文件最大 15MB。部署到 Cloudflare Pages 后会使用站点自带的代理下载以绕过 CORS。</div>
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
            <div className="text-xs text-zinc-500">导入后会进入详情页，可手动校正字段。</div>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
                canSubmit ? 'bg-blue-600 hover:bg-blue-700' : 'bg-zinc-300',
              )}
            >
              {busy ? '导入中…' : '开始导入'}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">解析说明</h2>
          <ul className="mt-2 space-y-1 text-sm text-zinc-600">
            <li>字段抽取基于本地解析与规则匹配，不使用任何付费 API。</li>
            <li>自我介绍摘要为抽取式摘要，保持原语言，不做翻译。</li>
            <li>解析不准的字段可在详情页手动修改并保存。</li>
            <li>如果你配置了 Poe/OpenAI 兼容网关，系统会额外用 AI 做字段纠错与补全（详情页会显示 AI 是否生效）。</li>
            <li>批量导入支持标准化表格字段，显示逐行处理进度与失败提示。</li>
          </ul>
        </div>
      </main>
    </div>
  )
}

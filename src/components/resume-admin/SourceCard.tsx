import StatusBadge from '@/components/resume-admin/StatusBadge'
import { resumeFileUrl } from '@/modules/resumes/rmcApi'
import type { ResumeDetail } from '@/modules/resumes/rmcTypes'

export default function SourceCard({ item }: { item: ResumeDetail }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 lg:sticky lg:top-4">
      <h2 className="text-sm font-semibold text-zinc-900">Source & Status</h2>
      <div className="mt-3 space-y-2 text-sm text-zinc-700">
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">AI</span>
          <span className={item.ai_used ? 'text-emerald-700' : 'text-zinc-700'}>
            {item.ai_used ? `Enabled${item.ai_model ? ` (${item.ai_model})` : ''}` : 'Disabled'}
          </span>
        </div>
        {!item.ai_used && item.ai_error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {item.ai_error}
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">Status</span>
          <StatusBadge status={item.parse_status} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-zinc-500">Source</span>
          <span className="truncate">{item.source_type}</span>
        </div>
        {item.original_filename ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-500">File Name</span>
            <span className="truncate">{item.original_filename}</span>
          </div>
        ) : null}
        {item.source_url ? (
          <div className="space-y-1">
            <div className="text-zinc-500">Link</div>
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-blue-700 hover:underline"
            >
              {item.source_url}
            </a>
          </div>
        ) : null}
        <div className="pt-2">
          <a
            href={resumeFileUrl(item)}
            className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Download Original File
          </a>
        </div>
        {item.parse_status === 'failed' && item.parse_error ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {item.parse_error}
          </div>
        ) : null}
        {item.parse_status === 'processing' ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Parsing in progress. This page will refresh automatically.
          </div>
        ) : null}
      </div>
    </div>
  )
}

import { cn } from '@/lib/utils'
import type { ParseStatus } from '@/modules/resumes/rmcTypes'

export default function StatusBadge({ status }: { status: ParseStatus }) {
  const cfg: Record<ParseStatus, { label: string; className: string }> = {
    processing: { label: 'Processing', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
    success: { label: 'Imported', className: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
    failed: { label: 'Failed', className: 'bg-red-50 text-red-800 ring-red-200' },
  }

  const c = cfg[status]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        c.className,
      )}
    >
      {c.label}
    </span>
  )
}


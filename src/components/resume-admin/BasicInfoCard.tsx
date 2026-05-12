import StatusBadge from '@/components/resume-admin/StatusBadge'
import Field from '@/components/resume-admin/Field'
import type { ResumeDetail } from '@/modules/resumes/rmcTypes'

export default function BasicInfoCard({
  item,
  effective,
  setField,
}: {
  item: ResumeDetail
  effective: ResumeDetail
  setField: <K extends keyof ResumeDetail>(key: K, value: ResumeDetail[K]) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">Basic Info</h2>
        <StatusBadge status={item.parse_status} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="First Name">
          <input
            value={effective.first_name || ''}
            onChange={(e) => setField('first_name', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Last Name">
          <input
            value={effective.last_name || ''}
            onChange={(e) => setField('last_name', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Years of Experience">
          <input
            value={String(effective.work_years ?? 0)}
            onChange={(e) => {
              const v = e.target.value.trim()
              if (!v) setField('work_years', 0)
              else setField('work_years', Number(v))
            }}
            inputMode="numeric"
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Job Direction">
          <input
            value={effective.job_direction || ''}
            onChange={(e) => setField('job_direction', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Admin Note">
          <input
            value={effective.admin_note || ''}
            onChange={(e) => {
              const v = e.target.value.slice(0, 20)
              setField('admin_note', v || null)
            }}
            maxLength={20}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Country">
          <input
            value={effective.country || ''}
            onChange={(e) => setField('country', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
        </Field>
        <Field label="City">
          <input
            value={effective.city || ''}
            onChange={(e) => setField('city', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
        </Field>
      </div>
    </div>
  )
}

import Field from '@/components/resume-admin/Field'
import type { ResumeDetail } from '@/modules/resumes/rmcTypes'

export default function ContactCard({
  effective,
  setField,
}: {
  effective: ResumeDetail
  setField: <K extends keyof ResumeDetail>(key: K, value: ResumeDetail[K]) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">联系方式</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="邮箱">
          <input
            value={effective.email || ''}
            onChange={(e) => setField('email', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
        </Field>
        <Field label="电话">
          <input
            value={effective.phone || ''}
            onChange={(e) => setField('phone', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
        </Field>
        <Field label="WhatsApp">
          <input
            value={effective.whatsapp || ''}
            onChange={(e) => setField('whatsapp', e.target.value || null)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
        </Field>
      </div>
    </div>
  )
}


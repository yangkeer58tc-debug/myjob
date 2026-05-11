import Field from '@/components/resume-admin/Field'
import type { EducationItem } from '@/modules/resumes/rmcTypes'

export default function EducationEditor({
  education,
  setEducation,
}: {
  education: EducationItem[]
  setEducation: (v: EducationItem[] | null) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">教育经历</h2>
        <button
          type="button"
          onClick={() => setEducation([...education, { degree: '', startDate: '', endDate: '' }])}
          className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200"
        >
          添加
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {education.length ? (
          education.map((e, idx) => (
            <div key={idx} className="rounded-md border border-zinc-200 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="学位">
                  <input
                    value={e.degree || ''}
                    onChange={(ev) =>
                      setEducation(
                        education.map((x, i) => (i === idx ? { ...x, degree: ev.target.value } : x)),
                      )
                    }
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="起始年份">
                  <input
                    value={e.startDate || ''}
                    onChange={(ev) =>
                      setEducation(
                        education.map((x, i) => (i === idx ? { ...x, startDate: ev.target.value } : x)),
                      )
                    }
                    inputMode="numeric"
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="结束年份">
                  <input
                    value={e.endDate || ''}
                    onChange={(ev) =>
                      setEducation(education.map((x, i) => (i === idx ? { ...x, endDate: ev.target.value } : x)))
                    }
                    inputMode="numeric"
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                  />
                </Field>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const next = education.filter((_, i) => i !== idx)
                    setEducation(next.length ? next : null)
                  }}
                  className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  删除
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm text-zinc-600">暂无教育经历</div>
        )}
      </div>
    </div>
  )
}

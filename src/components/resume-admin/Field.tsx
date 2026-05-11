export default function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-zinc-700">{label}</div>
      {children}
    </div>
  )
}


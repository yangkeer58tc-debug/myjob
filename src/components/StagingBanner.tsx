/**
 * Shown only for `vite build --mode staging` so the test deployment is visually distinct from production.
 */
export default function StagingBanner() {
  if (import.meta.env.MODE !== "staging") return null;
  return (
    <div
      className="sticky top-0 z-[100] w-full border-b border-amber-800/30 bg-amber-500/95 px-3 py-1.5 text-center text-xs font-medium text-amber-950 shadow-sm"
      role="status"
    >
      测试环境 — 非正式数据/配置，请勿当作线上站点使用
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { isResumeAdminEnabled } from '@/lib/featureFlags';

/**
 * 与后台职位管理共用主站 Supabase 登录；简历数据仍由 VITE_RESUMES_* 指向的库承载。
 */
const ResumeAdminLayout = () => {
  const enabled = isResumeAdminEnabled();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted px-4">
        <div className="max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-foreground">Resume Admin Is Disabled</h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            This deployment does not have <code className="rounded bg-muted px-1 py-0.5 text-xs">VITE_ENABLE_RESUME_ADMIN</code>
            enabled, so resume management is unavailable. Set it to{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">true</code> or <code className="rounded bg-muted px-1 py-0.5 text-xs">1</code>
            in Cloudflare Pages (or your current build environment), redeploy, and configure{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">VITE_RESUMES_*</code> as needed.
          </p>
          <Button asChild className="mt-6 rounded-xl">
            <Link to="/admin">Back to Admin</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-sm text-zinc-600">
        Loading...
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/admin" replace />;
  }
  return <Outlet />;
};

export default ResumeAdminLayout;

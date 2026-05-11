import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { isResumeAdminEnabled } from '@/lib/featureFlags';
import NotFound from '@/pages/NotFound';

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
    return <NotFound />;
  }
  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-sm text-zinc-600">
        加载中…
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/admin" replace />;
  }
  return <Outlet />;
};

export default ResumeAdminLayout;

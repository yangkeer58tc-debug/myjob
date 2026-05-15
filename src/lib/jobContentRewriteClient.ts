import type { JobRewriteApiResponse, JobRewriteInput } from '@/lib/jobContentRewriteTypes';

export async function fetchJobRewriteStatus(): Promise<{
  configured: boolean;
  model?: string;
}> {
  try {
    const res = await fetch('/job-rewrite', { method: 'GET' });
    const data = (await res.json().catch(() => null)) as {
      configured?: boolean;
      meta?: { model?: string };
    };
    return { configured: Boolean(data?.configured), model: data?.meta?.model };
  } catch {
    return { configured: false };
  }
}

export async function rewriteJobContent(input: JobRewriteInput): Promise<JobRewriteApiResponse> {
  const res = await fetch('/job-rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => null)) as JobRewriteApiResponse | null;
  if (!data || typeof data !== 'object') {
    return { success: false, error: `Invalid response (${res.status})` };
  }
  return data;
}

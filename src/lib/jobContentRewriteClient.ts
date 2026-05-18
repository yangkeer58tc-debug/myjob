import type { JobRewriteApiResponse, JobRewriteInput } from '@/lib/jobContentRewriteTypes';
import {
  clientJobRewriteModelName,
  hasClientJobRewriteLlm,
  rewriteJobContentViaClient,
} from '@/lib/jobContentRewriteLlm';

export type JobRewriteStatus = {
  configured: boolean;
  serverConfigured: boolean;
  clientConfigured: boolean;
  channel: 'edge' | 'browser' | 'none';
  model?: string;
};

export async function fetchJobRewriteStatus(): Promise<JobRewriteStatus> {
  const clientConfigured = hasClientJobRewriteLlm();
  let serverConfigured = false;
  let model = clientConfigured ? clientJobRewriteModelName() : undefined;

  try {
    const res = await fetch('/job-rewrite', { method: 'GET' });
    const data = (await res.json().catch(() => null)) as {
      configured?: boolean;
      meta?: { model?: string };
    };
    serverConfigured = Boolean(data?.configured);
    if (data?.meta?.model) model = data.meta.model;
  } catch {
    serverConfigured = false;
  }

  const configured = serverConfigured || clientConfigured;
  const channel: JobRewriteStatus['channel'] = serverConfigured
    ? 'edge'
    : clientConfigured
      ? 'browser'
      : 'none';

  return { configured, serverConfigured, clientConfigured, channel, model };
}

export async function rewriteJobContent(input: JobRewriteInput): Promise<JobRewriteApiResponse> {
  try {
    const res = await fetch('/job-rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => null)) as JobRewriteApiResponse | null;

    if (data?.success) return data;

    const edgeAuthOrConfigFailed =
      res.status === 501 || res.status === 502 || res.status === 404 || res.status === 401 || res.status === 403;
    const edgeLlmError =
      !data?.success &&
      typeof data?.error === 'string' &&
      /gemini_403|gemini_401|openai_401|openai_403|suspended|Permission denied/i.test(data.error);

    if ((edgeAuthOrConfigFailed || edgeLlmError) && hasClientJobRewriteLlm()) {
      return rewriteJobContentViaClient(input);
    }

    if (data && typeof data === 'object') return data;

    if (hasClientJobRewriteLlm()) return rewriteJobContentViaClient(input);
    return { success: false, error: `Invalid response (${res.status})` };
  } catch {
    if (hasClientJobRewriteLlm()) return rewriteJobContentViaClient(input);
    return { success: false, error: '无法连接 /job-rewrite，且浏览器侧未配置 LLM_*' };
  }
}

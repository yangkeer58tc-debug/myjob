import type { JobRewriteApiResponse, JobRewriteInput } from '@/lib/jobContentRewriteTypes';
import {
  clientJobRewriteModelName,
  hasClientJobRewriteLlm,
  rewriteJobContentViaClient,
} from '@/lib/jobContentRewriteLlm';
import { jobRewriteMaxRetries } from '@/lib/jobRewriteLimits';

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function errorText(res: JobRewriteApiResponse | null, status?: number): string {
  const parts = [String(res?.error || ''), status != null ? String(status) : ''].filter(Boolean);
  return parts.join(' ');
}

function isGeminiSuspended(msg: string): boolean {
  return /suspended|has been suspended|consumer 'api_key/i.test(msg);
}

function isTransientGeminiError(msg: string): boolean {
  return (
    /429|503|502|500|rate.?limit|resource.?exhausted|quota|too many requests|overloaded|unavailable|high demand|temporarily|try again/i.test(
      msg,
    )
  );
}

function isHighDemand503(msg: string): boolean {
  return /503|high demand|spikes in demand/i.test(msg);
}

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

    const errMsg = errorText(data, res.status);
    if (isGeminiSuspended(errMsg)) {
      return (
        data ?? {
          success: false,
          error:
            'Gemini API Key 已被停用 (suspended)。请更换账号/Key，勿提高并发；勿在浏览器构建变量中暴露 Key。',
        }
      );
    }

    // Only fall back when the edge function is missing — not on LLM 502/503 (avoids doubling load).
    if ((res.status === 501 || res.status === 404) && hasClientJobRewriteLlm()) {
      return rewriteJobContentViaClient(input);
    }

    if (data && typeof data === 'object') return data;
    return { success: false, error: `Invalid response (${res.status})` };
  } catch {
    if (hasClientJobRewriteLlm()) return rewriteJobContentViaClient(input);
    return { success: false, error: '无法连接 /job-rewrite，且浏览器侧未配置 LLM_*' };
  }
}

/** Rewrite with backoff on 429/503; never retries suspended keys or hammers a second channel. */
export async function rewriteJobContentWithRetry(input: JobRewriteInput): Promise<JobRewriteApiResponse> {
  const attempts = jobRewriteMaxRetries();
  let last: JobRewriteApiResponse = { success: false, error: 'LLM failed' };

  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await rewriteJobContent(input);
    if (last.success) return last;

    const msg = errorText(last);
    if (isGeminiSuspended(msg)) return last;
    if (!isTransientGeminiError(msg) || attempt >= attempts - 1) {
      if (isHighDemand503(msg)) {
        return {
          ...last,
          error:
            'Gemini 模型繁忙 (503)，已自动重试仍失败。请稍后再试、减小 CSV 批次，或在 LLM_MODEL 改用 gemini-2.0-flash。',
        };
      }
      return last;
    }

    const base = isHighDemand503(msg) ? 5000 : 2500;
    const backoff = Math.min(90_000, base * 2 ** attempt) + Math.floor(Math.random() * 800);
    await sleep(backoff);
  }

  return last;
}

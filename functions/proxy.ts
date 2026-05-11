type ProxyResponseInit = {
  status?: number
  headers?: Record<string, string>
}

function json(data: unknown, init?: ProxyResponseInit) {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...(init?.headers || {}),
    },
  })
}

function isPrivateIp(host: string) {
  const h = host.trim().toLowerCase()
  if (h === 'localhost') return true
  if (h === '127.0.0.1' || h === '0.0.0.0') return true
  if (h === '::1') return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if ([a, b].some((n) => Number.isNaN(n))) return false
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}

export async function onRequestGet({ request }: { request: Request }) {
  const url = new URL(request.url)
  const target = url.searchParams.get('url')
  if (!target) return json({ success: false, error: 'Missing url' }, { status: 400 })

  let u: URL
  try {
    u = new URL(target)
  } catch {
    return json({ success: false, error: 'Invalid url' }, { status: 400 })
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return json({ success: false, error: 'Only http/https is allowed' }, { status: 400 })
  }

  if (isPrivateIp(u.hostname)) {
    return json({ success: false, error: 'Blocked host' }, { status: 400 })
  }

  const MAX_BYTES = 15 * 1024 * 1024

  const upstream = await fetch(u.toString(), {
    redirect: 'follow',
    headers: {
      'User-Agent': 'ResumeLibraryProxy/1.0',
    },
  })

  if (!upstream.ok || !upstream.body) {
    return json(
      { success: false, error: `Upstream failed: ${upstream.status}` },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    )
  }

  const lenHeader = upstream.headers.get('content-length')
  if (lenHeader) {
    const n = Number(lenHeader)
    if (!Number.isNaN(n) && n > MAX_BYTES) {
      return json({ success: false, error: 'File too large' }, { status: 413 })
    }
  }

  const ct = upstream.headers.get('content-type') || 'application/octet-stream'
  const outHeaders = new Headers({
    'Content-Type': ct,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })

  const reader = upstream.body.getReader()
  let total = 0
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      if (value) {
        total += value.byteLength
        if (total > MAX_BYTES) {
          controller.error(new Error('File too large'))
          try {
            reader.cancel()
          } catch {
            // ignore
          }
          return
        }
        controller.enqueue(value)
      }
    },
    cancel() {
      try {
        reader.cancel()
      } catch {
        // ignore
      }
    },
  })

  return new Response(stream, { status: 200, headers: outHeaders })
}


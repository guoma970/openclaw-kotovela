/**
 * Public-facing gateway for Kotovela Hub live data.
 *
 * This process is intentionally narrower than `office-api-server.ts`: it proxies
 * selected read-only endpoints plus one constrained study-message relay for
 * the configured 果果学习协同群 / 布置群 targets. It still rejects arbitrary write paths.
 * Use it behind Tailscale Funnel or another public HTTPS tunnel instead of
 * exposing the full local office API.
 */
import http from 'node:http'

const PORT = Number.parseInt(process.env.OFFICE_READONLY_GATEWAY_PORT || '8791', 10)
const HOST = process.env.OFFICE_READONLY_GATEWAY_HOST?.trim() || '127.0.0.1'
const PUBLIC_TOKEN = process.env.OFFICE_READONLY_GATEWAY_TOKEN?.trim()
const UPSTREAM_ORIGIN = process.env.OFFICE_READONLY_GATEWAY_UPSTREAM_ORIGIN?.trim() || 'http://127.0.0.1:8787'
const UPSTREAM_TOKEN = process.env.OFFICE_READONLY_GATEWAY_UPSTREAM_TOKEN?.trim()
const CORS_ORIGIN = process.env.OFFICE_READONLY_GATEWAY_CORS_ORIGIN?.trim() || 'https://kotovelahub.vercel.app'
const UPSTREAM_TIMEOUT_MS = Number.parseInt(process.env.OFFICE_READONLY_GATEWAY_TIMEOUT_MS || '12000', 10)

const READONLY_PATHS = new Set([
  '/api/office-instances',
  '/api/model-usage',
  '/api/guoma-board',
  '/api/tasks-board',
  '/api/audit-log',
  '/api/xiguo-task',
])

const CONTROLLED_WRITE_PATHS = new Set([
  '/api/xiguo-study-message',
  '/api/xiguo-task-create',
  '/api/xiguo-task-status',
])

const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
  })
  res.end(JSON.stringify(body))
}

const readBearer = (req: http.IncomingMessage) => {
  const authorization = req.headers.authorization
  if (!authorization?.startsWith('Bearer ')) return ''
  return authorization.slice('Bearer '.length).trim()
}

const isAuthorized = (req: http.IncomingMessage, url: URL) => {
  if (!PUBLIC_TOKEN) return false
  return readBearer(req) === PUBLIC_TOKEN || url.searchParams.get('token')?.trim() === PUBLIC_TOKEN
}

const proxyReadOnlyRequest = async (pathname: string, search: string) => {
  const upstream = new URL(pathname, UPSTREAM_ORIGIN)
  upstream.search = search

  const response = await fetch(upstream, {
    headers: UPSTREAM_TOKEN ? { Authorization: `Bearer ${UPSTREAM_TOKEN}` } : undefined,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  const text = await response.text()

  return {
    ok: response.ok,
    status: response.status,
    body: text ? JSON.parse(text) as unknown : null,
  }
}

const readRequestBody = async (req: http.IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

const proxyControlledWriteRequest = async (pathname: string, body: string) => {
  const upstream = new URL(pathname, UPSTREAM_ORIGIN)

  const response = await fetch(upstream, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(UPSTREAM_TOKEN ? { Authorization: `Bearer ${UPSTREAM_TOKEN}` } : {}),
    },
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  const text = await response.text()

  return {
    ok: response.ok,
    status: response.status,
    body: text ? JSON.parse(text) as unknown : null,
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Vary', 'Origin')

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  if (url.pathname === '/healthz') {
    sendJson(res, 200, {
      ok: true,
      service: 'kotovela-office-readonly-gateway',
      readonlyPaths: Array.from(READONLY_PATHS),
      controlledWritePaths: Array.from(CONTROLLED_WRITE_PATHS),
    })
    return
  }

  if (!READONLY_PATHS.has(url.pathname) && !CONTROLLED_WRITE_PATHS.has(url.pathname)) {
    sendJson(res, 404, { error: 'not_found', message: 'gateway only exposes selected live-data APIs and fixed study relay' })
    return
  }

  const isControlledWrite = CONTROLLED_WRITE_PATHS.has(url.pathname)
  if (isControlledWrite ? req.method !== 'POST' : (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.setHeader('Allow', isControlledWrite ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS')
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  if (!isAuthorized(req, url)) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }

  try {
    if (isControlledWrite) {
      const payload = await proxyControlledWriteRequest(url.pathname, await readRequestBody(req))
      sendJson(res, payload.status, payload.body)
      return
    }

    const payload = await proxyReadOnlyRequest(url.pathname, url.search)
    if (req.method === 'HEAD') {
      res.writeHead(payload.status, { 'Cache-Control': 'no-store, max-age=0' }).end()
      return
    }
    sendJson(res, payload.status, payload.body)
  } catch (error) {
    sendJson(res, 502, {
      error: 'readonly_gateway_upstream_failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

server.listen(PORT, HOST, () => {
  const baseUrl = `http://${HOST}:${PORT}`
  console.log(`[office-readonly-gateway] listening ${baseUrl}`)
  console.log(`[office-readonly-gateway] readonly paths: ${Array.from(READONLY_PATHS).join(', ')}`)
  console.log(`[office-readonly-gateway] controlled write paths: ${Array.from(CONTROLLED_WRITE_PATHS).join(', ')}`)
  if (!PUBLIC_TOKEN) {
    console.error('[office-readonly-gateway] OFFICE_READONLY_GATEWAY_TOKEN is required for public exposure')
  }
  if (!UPSTREAM_TOKEN) {
    console.warn('[office-readonly-gateway] upstream token not set; upstream must be otherwise protected')
  }
})

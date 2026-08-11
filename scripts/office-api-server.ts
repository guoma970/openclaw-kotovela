/**
 * 在 Mac mini（或任意已安装 openclaw CLI 的机器）上常驻运行，对外提供与 Vite dev 同形的 JSON。
 *
 * 启动示例：
 *   OFFICE_API_PORT=8787 OFFICE_API_TOKEN='你的密钥' OFFICE_API_CORS_ORIGIN='https://kotovelahub.vercel.app' npm run serve:office-api
 *
 * 外出访问：用 Cloudflare Tunnel / Tailscale Funnel / ngrok 等把本机端口暴露为 HTTPS，
 * 再在 Vercel internal 构建里设置对应上游 URL 指向该 HTTPS URL（含路径）。
 */
import http from 'node:http'
import { handleInternalWorkbenchRequest } from '../server/internalWorkbench.ts'
import { fetchModelUsagePayload } from '../server/modelUsage.ts'
import { fetchOfficeInstancesPayload } from '../server/officeInstances.ts'
import { fetchGuomaBoardPayload } from '../../kotovela-hub/server/guomaBoard.ts'
import { normalizeFeishuStudyAudience, sendOpenClawCliStudyMessage } from '../server/xiugDispatch.ts'

const PORT = Number.parseInt(process.env.OFFICE_API_PORT || '8787', 10)
const TOKEN = process.env.OFFICE_API_TOKEN?.trim()
const CORS_ORIGIN = process.env.OFFICE_API_CORS_ORIGIN?.trim() || '*'
const MODEL_USAGE_CACHE_MS = Number.parseInt(process.env.MODEL_USAGE_CACHE_MS || '60000', 10)
type ModelUsagePayload = Awaited<ReturnType<typeof fetchModelUsagePayload>>

const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

let modelUsageCache: { payload: ModelUsagePayload; refreshedAt: number } | undefined
let modelUsageRefresh: Promise<ModelUsagePayload> | undefined

const refreshModelUsageCache = async () => {
  if (modelUsageRefresh) return modelUsageRefresh

  modelUsageRefresh = fetchModelUsagePayload()
    .then((payload) => {
      modelUsageCache = { payload, refreshedAt: Date.now() }
      return payload
    })
    .finally(() => {
      modelUsageRefresh = undefined
    })

  return modelUsageRefresh
}

const fetchCachedModelUsagePayload = async () => {
  const now = Date.now()
  if (modelUsageCache && now - modelUsageCache.refreshedAt < MODEL_USAGE_CACHE_MS) {
    return modelUsageCache.payload
  }

  try {
    return await refreshModelUsageCache()
  } catch (error) {
    if (modelUsageCache) {
      return {
        ...modelUsageCache.payload,
        warnings: [
          `model usage refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          ...modelUsageCache.payload.warnings,
        ].slice(0, 20),
      }
    }
    throw error
  }
}

const API_HANDLERS = {
  '/api/office-instances': fetchOfficeInstancesPayload,
  '/api/model-usage': fetchCachedModelUsagePayload,
  '/api/guoma-board': fetchGuomaBoardPayload,
} as const

const INTERNAL_API_PATHS = new Set([
  '/api/tasks-board',
  '/api/audit-log',
  '/api/system-mode',
  '/api/leads',
  '/api/lead-stats',
  '/api/content-feedback',
  '/api/task-notifications',
  '/api/task-notification-actions',
  '/api/xiguo-task',
  '/api/xiguo-task-create',
  '/api/xiguo-task-status',
  '/api/xiguo-task-alerts',
])

const CONTROLLED_WRITE_API_PATHS = new Set([
  '/api/xiguo-study-message',
])

const readRequestBody = async (req: http.IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const buildInternalRequestInput = async (url: URL, req: http.IncomingMessage) => {
  const query = Object.fromEntries(url.searchParams)
  if (req.method === 'GET') return query
  return {
    ...query,
    ...asObject(await readRequestBody(req)),
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const apiHandler = (API_HANDLERS as Record<string, (() => Promise<unknown>) | undefined>)[url.pathname]
  const isInternalApiPath = INTERNAL_API_PATHS.has(url.pathname)
  const isControlledWriteApiPath = CONTROLLED_WRITE_API_PATHS.has(url.pathname)

  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  if (!apiHandler && !isInternalApiPath && !isControlledWriteApiPath) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  if (apiHandler && req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  if (TOKEN) {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : ''
    const queryToken = url.searchParams.get('token')?.trim() ?? ''
    if (bearer !== TOKEN && queryToken !== TOKEN) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }
  }

  try {
    if (apiHandler) {
      const payload = await apiHandler()
      sendJson(res, 200, payload)
      return
    }

    if (isControlledWriteApiPath) {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        sendJson(res, 405, { error: 'method_not_allowed' })
        return
      }

      const body = await readRequestBody(req)
      const text = typeof body === 'object' && body !== null && 'text' in body
        ? String((body as { text?: unknown }).text ?? '').trim()
        : ''
      const audience = typeof body === 'object' && body !== null && 'audience' in body
        ? normalizeFeishuStudyAudience((body as { audience?: unknown }).audience)
        : 'collab'
      if (!text) {
        sendJson(res, 400, { ok: false, error: 'missing_text' })
        return
      }

      const result = await sendOpenClawCliStudyMessage(text, audience)
      sendJson(res, result.ok ? 200 : 502, result)
      return
    }

    const payload = await handleInternalWorkbenchRequest(url.pathname, req.method ?? 'GET', await buildInternalRequestInput(url, req))
    if (payload.allow) res.setHeader('Allow', payload.allow)
    sendJson(res, payload.status, payload.body)
  } catch (error) {
    sendJson(res, 500, {
      error: `${url.pathname} fetch failed`,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

const host = process.env.OFFICE_API_HOST?.trim() || '0.0.0.0'

server.listen(PORT, host, () => {
  const baseUrl = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${PORT}`
  console.log(
    `[office-api] listening ${baseUrl}/api/office-instances, ${baseUrl}/api/model-usage and internal workbench APIs`,
  )
  if (TOKEN) {
    console.log('[office-api] token auth enabled (Authorization: Bearer … or ?token=)')
  } else {
    console.warn('[office-api] OFFICE_API_TOKEN not set — only use behind VPN / tunnel with access control')
  }
  void refreshModelUsageCache().catch((error) => {
    console.warn(`[office-api] model usage warmup failed: ${error instanceof Error ? error.message : String(error)}`)
  })
})

setInterval(() => {
  void refreshModelUsageCache().catch((error) => {
    console.warn(`[office-api] model usage refresh failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}, MODEL_USAGE_CACHE_MS).unref()

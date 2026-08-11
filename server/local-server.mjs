#!/usr/bin/env node
import http from 'node:http'
import fs from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import accessHandler from '../api/access.ts'
import auditLogHandler from '../api/audit-log.ts'
import contentFeedbackHandler from '../api/content-feedback.ts'
import leadStatsHandler from '../api/lead-stats.ts'
import leadsHandler from '../api/leads.ts'
import modelUsageHandler from '../api/model-usage.ts'
import officeInstancesHandler from '../api/office-instances.ts'
import systemModeHandler from '../api/system-mode.ts'
import taskNotificationsHandler from '../api/task-notifications.ts'
import tasksBoardHandler from '../api/tasks-board.ts'
import xiguoActionHandler from '../api/xiguo/[action].ts'
import xiguoDispatchHandler from '../api/xiguo-dispatch.ts'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8812
const MAX_BODY_BYTES = 10 * 1024 * 1024

const routeHandlers = new Map([
  ['/api/access', accessHandler],
  ['/api/audit-log', auditLogHandler],
  ['/api/content-feedback', contentFeedbackHandler],
  ['/api/lead-stats', leadStatsHandler],
  ['/api/leads', leadsHandler],
  ['/api/model-usage', modelUsageHandler],
  ['/api/office-instances', officeInstancesHandler],
  ['/api/system-mode', systemModeHandler],
  ['/api/task-notifications', taskNotificationsHandler],
  ['/api/tasks-board', tasksBoardHandler],
  ['/api/xiguo-dispatch', xiguoDispatchHandler],
])

const xiguoRewrites = new Map([
  ['/api/xiguo-task', 'task'],
  ['/api/xiguo-task-status', 'task-status'],
  ['/api/xiguo-task-create', 'task-create'],
  ['/api/xiguo-task-alerts', 'task-alerts'],
])

const normalizePathname = (pathname) => {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

const parseEnvValue = (value) => {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n')
  }
  return trimmed
}

const loadEnvFile = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return

  const contents = fs.readFileSync(filePath, 'utf8')
  for (const line of contents.split(/\r?\n/)) {
    const cleaned = line.trim()
    if (!cleaned || cleaned.startsWith('#')) continue
    const match = cleaned.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] === undefined) process.env[key] = parseEnvValue(rawValue)
  }
}

loadEnvFile(process.env.KOTOVELA_API_ENV_FILE || process.env.LOCAL_API_ENV_FILE)

const toQueryObject = (searchParams) => {
  const query = {}
  for (const [key, value] of searchParams.entries()) {
    const previous = query[key]
    if (previous === undefined) {
      query[key] = value
    } else if (Array.isArray(previous)) {
      previous.push(value)
    } else {
      query[key] = [previous, value]
    }
  }
  return query
}

const readBodyText = async (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') return ''

  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      const error = new Error('request body too large')
      error.statusCode = 413
      throw error
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const parseBody = (bodyText, contentType) => {
  if (!bodyText) return undefined
  const normalizedType = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  if (normalizedType === 'application/json') return JSON.parse(bodyText)
  if (normalizedType === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(bodyText))
  }
  return bodyText
}

const createVercelRequest = (req, requestUrl, query, body) => {
  req.query = query
  req.body = body
  req.cookies = {}
  req.url = `${requestUrl.pathname}${requestUrl.search}`
  return req
}

const createVercelResponse = (res) => {
  const api = {
    get statusCode() {
      return res.statusCode
    },
    set statusCode(value) {
      res.statusCode = value
    },
    get headersSent() {
      return res.headersSent
    },
    setHeader(name, value) {
      res.setHeader(name, value)
      return api
    },
    getHeader(name) {
      return res.getHeader(name)
    },
    removeHeader(name) {
      res.removeHeader(name)
      return api
    },
    status(code) {
      res.statusCode = code
      return api
    },
    json(payload) {
      if (!res.headersSent && !res.hasHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
      }
      res.end(JSON.stringify(payload))
      return api
    },
    send(payload) {
      if (payload === undefined || payload === null) {
        res.end()
      } else if (Buffer.isBuffer(payload) || typeof payload === 'string') {
        res.end(payload)
      } else {
        api.json(payload)
      }
      return api
    },
    redirect(statusOrUrl, url) {
      const status = typeof statusOrUrl === 'number' ? statusOrUrl : 307
      const location = typeof statusOrUrl === 'number' ? url : statusOrUrl
      res.statusCode = status
      if (location) res.setHeader('Location', location)
      res.end()
      return api
    },
    end(payload) {
      res.end(payload)
      return api
    },
  }
  return api
}

const resolveRoute = (requestUrl) => {
  const pathname = normalizePathname(requestUrl.pathname)
  const query = toQueryObject(requestUrl.searchParams)

  const rewrittenXiguoAction = xiguoRewrites.get(pathname)
  if (rewrittenXiguoAction) {
    query.action = rewrittenXiguoAction
    return { handler: xiguoActionHandler, query, pathname }
  }

  if (pathname === '/api/task-notification-actions') {
    query.action = 'actions'
    return { handler: taskNotificationsHandler, query, pathname }
  }

  const xiguoMatch = pathname.match(/^\/api\/xiguo\/([^/]+)$/)
  if (xiguoMatch) {
    query.action = decodeURIComponent(xiguoMatch[1])
    return { handler: xiguoActionHandler, query, pathname }
  }

  return { handler: routeHandlers.get(pathname), query, pathname }
}

const sendNotFound = (res, pathname) => {
  res.statusCode = 404
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ ok: false, error: 'not_found', path: pathname }))
}

const sendError = (res, error) => {
  if (res.writableEnded) return
  const statusCode = Number(error?.statusCode) || 500
  res.statusCode = statusCode
  if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({
    ok: false,
    error: statusCode === 413 ? 'payload_too_large' : 'local_api_error',
    message: error instanceof Error ? error.message : String(error),
  }))
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `${DEFAULT_HOST}:${DEFAULT_PORT}`
    const requestUrl = new URL(req.url || '/', `http://${host}`)
    const route = resolveRoute(requestUrl)

    if (!route.handler) {
      sendNotFound(res, route.pathname)
      return
    }

    const bodyText = await readBodyText(req)
    const body = parseBody(bodyText, req.headers['content-type'])
    const vercelReq = createVercelRequest(req, requestUrl, route.query, body)
    const vercelRes = createVercelResponse(res)
    await Promise.resolve(route.handler(vercelReq, vercelRes))
    if (!res.writableEnded) res.end()
  } catch (error) {
    sendError(res, error)
  }
})

const port = Number(process.env.PORT || DEFAULT_PORT)
const host = process.env.HOST || DEFAULT_HOST

server.listen(port, host, () => {
  const envFile = process.env.KOTOVELA_API_ENV_FILE || process.env.LOCAL_API_ENV_FILE
  const envLabel = envFile ? path.resolve(envFile.replace(/^~/, homedir())) : 'process env'
  console.log(`[kotovela-workbench-api] listening on http://${host}:${port} (${envLabel})`)
})

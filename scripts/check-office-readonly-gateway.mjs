#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8791'
const baseUrl = (process.env.OFFICE_READONLY_GATEWAY_CHECK_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
const envFile = process.env.OFFICE_READONLY_GATEWAY_ENV_FILE
  || path.join(os.homedir(), '.config/kotovela/office-readonly-gateway.env')

const unquoteShellValue = (value) => {
  const trimmed = value.trim()
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) return trimmed
  return trimmed.slice(1, -1).replace(/'\\''/g, "'")
}

const readTokenFromEnvFile = () => {
  try {
    const text = fs.readFileSync(envFile, 'utf8')
    const line = text.split(/\r?\n/).find((row) => row.startsWith('export OFFICE_READONLY_GATEWAY_TOKEN='))
    if (!line) return ''
    return unquoteShellValue(line.slice('export OFFICE_READONLY_GATEWAY_TOKEN='.length))
  } catch {
    return ''
  }
}

const token = process.env.OFFICE_READONLY_GATEWAY_CHECK_TOKEN
  || process.env.OFFICE_READONLY_GATEWAY_TOKEN
  || readTokenFromEnvFile()

const fetchJson = async (pathname, options = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, options)
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { response, body }
}

const expectStatus = async (label, pathname, expectedStatus, options = {}) => {
  const { response, body } = await fetchJson(pathname, options)
  if (response.status !== expectedStatus) {
    throw new Error(`${label} expected HTTP ${expectedStatus}, got HTTP ${response.status}: ${JSON.stringify(body)}`)
  }
  console.log(`[check:readonly-gateway] ${label}: HTTP ${response.status}`)
  return body
}

const summarizeOfficeInstances = (body) => {
  const instances = Array.isArray(body?.instances) ? body.instances : []
  return {
    source: body?.source ?? '(missing)',
    generatedAt: body?.generatedAt ?? '(missing)',
    instances: instances.length,
  }
}

const summarizeModelUsage = (body) => ({
  source: body?.source ?? '(missing)',
  agents: Array.isArray(body?.agents) ? body.agents.length : 0,
  warnings: Array.isArray(body?.warnings) ? body.warnings.length : 0,
})

const summarizeTasksBoard = (body) => ({
  total: Number.isFinite(body?.total) ? body.total : 0,
  board: Array.isArray(body?.board) ? body.board.length : 0,
  generatedAt: body?.generatedAt ?? '(missing)',
})

const summarizeAuditLog = (body) => ({
  entries: Array.isArray(body?.entries) ? body.entries.length : 0,
  generatedAt: body?.generatedAt ?? '(missing)',
})

const main = async () => {
  if (!token) {
    throw new Error(`Missing read-only gateway token. Set OFFICE_READONLY_GATEWAY_CHECK_TOKEN, or keep ${envFile} available.`)
  }

  console.log(`[check:readonly-gateway] base: ${baseUrl}`)

  await expectStatus('health', '/healthz', 200)
  await expectStatus('unauthorized office instances', '/api/office-instances', 401)
  await expectStatus('write method rejected', '/api/tasks-board', 405, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  await expectStatus('non-allowlisted path rejected', '/api/system-mode', 404, {
    headers: { Authorization: `Bearer ${token}` },
  })

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  const office = await expectStatus('office instances', '/api/office-instances', 200, { headers })
  const modelUsage = await expectStatus('model usage', '/api/model-usage', 200, { headers })
  const tasksBoard = await expectStatus('tasks board', '/api/tasks-board', 200, { headers })
  const auditLog = await expectStatus('audit log', '/api/audit-log', 200, { headers })

  console.log('[check:readonly-gateway] payload summary:')
  console.log('  office:', JSON.stringify(summarizeOfficeInstances(office)))
  console.log('  modelUsage:', JSON.stringify(summarizeModelUsage(modelUsage)))
  console.log('  tasksBoard:', JSON.stringify(summarizeTasksBoard(tasksBoard)))
  console.log('  auditLog:', JSON.stringify(summarizeAuditLog(auditLog)))
}

main().catch((error) => {
  console.error('[check:readonly-gateway] FAILED')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

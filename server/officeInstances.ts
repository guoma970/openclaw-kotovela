import { exec as execCommand } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const OFFICE_TARGET_KEYS = ['main', 'builder', 'media', 'family', 'business', 'personal'] as const

export const OFFICE_ROLE_MAP: Record<string, string> = {
  main: '中枢调度',
  builder: '研发执行',
  media: '内容助手',
  family: '家庭助手',
  business: '业务助手',
  personal: '个人助手',
  ztl970: '个人助手',
}

const OFFICE_PROJECT_RELATED_MAP: Record<string, string> = {
  main: 'KOTOVELAHUB研发群',
  builder: 'KOTOVELAHUB研发群',
  media: '内容创作协同项目',
  family: '家庭事务协同项目',
  business: '业务增长协同项目',
  personal: '个人助手协同项目',
}

const FEISHU_CHAT_ID_TO_NAME: Record<string, string> = {
  demo_kotovela_hub_research_chat: 'Kotovela Hub Demo 研发群',
  demo_workbench_legacy_chat: 'Kotovela Workbench Demo 历史群',
  demo_builder_chat: 'Builder Demo 协作群',
  demo_family_chat: 'Family Demo 协作群',
  demo_business_chat: 'Business Demo 协作群',
}

type SessionItem = {
  key?: string
  /** Original session key before agent-id normalization (e.g. agent:main:feishu:group:oc_…) */
  sessionKeyRaw?: string
  name?: string
  role?: string
  status?: string
  task?: string
  currentTask?: string
  updatedAt?: string
  ageMs?: number | string
  ageText?: string
  kind?: string
  agentId?: string
  model?: string
  /** When no matching session row exists for this slot (final payload only) */
  slotKey?: string
  [key: string]: unknown
}

type SessionResponse = {
  data?: {
    instances?: SessionItem[]
    sessions?: SessionItem[]
  }
  instances?: SessionItem[]
  sessions?: SessionItem[]
}

type OfficeSnapshotPayload = {
  generatedAt?: string
  source?: string
  instances?: ReturnType<typeof buildFallbackSession>[]
}

const officeSnapshotInstanceSchema = z
  .object({
    key: z.enum(OFFICE_TARGET_KEYS),
    name: z.string(),
    role: z.string(),
    status: z.string(),
    task: z.string(),
    updatedAt: z.string(),
    ageMs: z.union([z.number().finite().nonnegative(), z.string()]).optional(),
    ageText: z.string().optional(),
    sessionKeyRaw: z.string().optional(),
    kind: z.string().optional(),
    model: z.string().optional(),
    currentTask: z.string().optional(),
    projectRelated: z.string().optional(),
  })
  .strict()

const officeSnapshotPayloadSchema = z
  .object({
    generatedAt: z.string().optional(),
    source: z.string().optional(),
    instances: z.array(officeSnapshotInstanceSchema).optional(),
  })
  .strict()

const serverDir = path.dirname(fileURLToPath(import.meta.url))
const snapshotPath = path.resolve(
  process.env.OFFICE_INSTANCES_SNAPSHOT_PATH ?? path.resolve(serverDir, '../data/office-instances.snapshot.json'),
)

const toMs = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  return undefined
}

const normalizeSessionKey = (value: unknown): string => {
  const trimmed = typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : ''
  if (!trimmed) {
    return ''
  }

  const parts = trimmed.split(':')
  if (parts[0] === 'agent' && parts.length >= 2) {
    const key = parts[1]
    return key === 'ztl970' ? 'personal' : key
  }
  return trimmed === 'ztl970' ? 'personal' : trimmed
}

const extractFeishuChatId = (raw: string): string | undefined => {
  const m = /(?:^|:)oc_[a-z0-9]{8,}(?:$|:)?/i.exec(raw)
  if (!m) return undefined
  return m[0].replace(/:/g, '').toLowerCase()
}

const pickSessionRichText = (session: SessionItem): string => {
  const candidates: unknown[] = [
    session.task,
    session.currentTask,
    session.title,
    session.summary,
    session.note,
    session.latestMessage,
    session.lastMessage,
    session.preview,
    session.content,
    session.snippet,
    session.description,
  ]
  for (const value of candidates) {
    if (typeof value !== 'string') continue
    const t = value.trim()
    if (!t) continue
    if (t === '暂无任务') continue
    return t
  }
  return ''
}

/** When OpenClaw JSON has no task/currentTask, derive a one-line summary for the cockpit. */
const inferTaskSummary = (session: SessionItem): string => {
  const rich = pickSessionRichText(session)
  if (rich) return rich

  const raw = typeof session.sessionKeyRaw === 'string' ? session.sessionKeyRaw : ''
  const kind = typeof session.kind === 'string' ? session.kind.toLowerCase() : ''
  const key = typeof session.key === 'string' ? session.key.trim().toLowerCase() : ''

  if (kind === 'group' || raw.includes('feishu:group') || raw.includes(':group:')) {
    const chatId = extractFeishuChatId(raw)
    const groupName = chatId ? FEISHU_CHAT_ID_TO_NAME[chatId] : undefined
    if (groupName) return `飞书群会话 · ${groupName}`
    const tail = chatId || raw.split(':').filter(Boolean).pop() || ''
    const shortId = tail.length > 14 ? `${tail.slice(0, 10)}…` : tail
    return shortId ? `飞书群会话 · ${shortId}` : '飞书群会话'
  }

  if (kind === 'direct') {
    if (key === 'media') return '诗句创作中，待同步最新内容'
    if (key) return `实例 ${key} · 直连会话进行中`
    return '直连会话进行中'
  }

  if (raw.includes('feishu')) {
    return '飞书会话'
  }

  const slot = typeof session.slotKey === 'string' ? session.slotKey.trim() : ''
  if (slot) {
    return `实例 ${slot} · 暂无任务上报（请同步任务标题/摘要）`
  }

  return '等待新任务（飞书群）'
}

const parseSessionOutput = (raw: unknown): SessionItem[] => {
  if (!raw || typeof raw !== 'object') {
    return []
  }

  const obj = raw as SessionResponse
  const rawList = obj.data?.instances ?? obj.instances
  const sessionList = obj.data?.sessions ?? obj.sessions
  const list = Array.isArray(rawList) ? rawList : Array.isArray(sessionList) ? sessionList : []

  if (!Array.isArray(list)) {
    return []
  }

  const mapped = list
    .filter((item): item is SessionItem => typeof item === 'object' && item !== null)
    .map((item) => {
      const originalKey =
        typeof item.key === 'string' ? item.key : item.key != null ? String(item.key) : ''
      const agentId = typeof item.agentId === 'string' ? item.agentId.trim() : ''
      const sessionKeyRaw = originalKey || (agentId ? `agent:${agentId}` : '')
      return {
        ...item,
        sessionKeyRaw,
        key: normalizeSessionKey(item.key ?? item.agentId),
        updatedAt: typeof item.ageMs === 'number' ? `最近 ${Math.max(1, Math.round(item.ageMs / 1000))} 秒` : item.updatedAt,
      }
    })

  const deduped: Record<string, SessionItem> = {}
  for (const item of mapped) {
    if (!item.key) {
      continue
    }

    const existing = deduped[item.key]
    const currentAge = toMs(item.ageMs)
    const existingAge = toMs(existing?.ageMs)

    if (!existing || (currentAge !== undefined && (existingAge === undefined || currentAge < existingAge))) {
      deduped[item.key] = item
    }
  }

  return Object.values(deduped)
}

const buildFallbackSession = (session: SessionItem) => {
  const key = String(session.key || '').trim()
  const ageMs = toMs(session.ageMs)
  const updatedAt = session.ageText || (typeof session.updatedAt === 'string' ? session.updatedAt : '刚刚')

  return {
    key,
    name: session.name || key || '未知实例',
    role: session.role || OFFICE_ROLE_MAP[key] || '未设置角色',
    status: typeof session.status === 'string' && session.status.length > 0 ? session.status : 'active',
    task: inferTaskSummary(session),
    sessionKeyRaw: session.sessionKeyRaw,
    kind: typeof session.kind === 'string' ? session.kind : undefined,
    model: typeof session.model === 'string' ? session.model : undefined,
    currentTask: typeof session.currentTask === 'string' ? session.currentTask : undefined,
    projectRelated: typeof session.projectRelated === 'string' ? session.projectRelated : undefined,
    updatedAt,
    ageMs,
    ageText: updatedAt,
  }
}

const statusByAge = (ageMs: number) => {
  const normalized = Math.max(0, ageMs)
  const fiveMin = 5 * 60 * 1000
  const thirtyMin = 30 * 60 * 1000

  if (normalized <= fiveMin) {
    return 'doing'
  }

  if (normalized <= thirtyMin) {
    return 'done'
  }

  return 'blocker'
}

const commandToOfficeResponse = async (): Promise<ReturnType<typeof buildFallbackSession>[]> =>
  new Promise((resolve) => {
    execCommand(
      'openclaw --log-level silent sessions --json --all-agents --active 240',
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve([])
          return
        }

        try {
          const parsed = JSON.parse(stdout) as unknown
          const sessions = parseSessionOutput(parsed)

          if (sessions.length > 0) {
            resolve(sessions.map(buildFallbackSession))
            return
          }
        } catch {
          // ignore
        }

        resolve([])
      },
    )
  })

const readSnapshotPayload = async (): Promise<OfficeSnapshotPayload | null> => {
  try {
    const raw = await readFile(snapshotPath, 'utf8')
    return officeSnapshotPayloadSchema.parse(JSON.parse(raw)) as OfficeSnapshotPayload
  } catch {
    return null
  }
}

const snapshotAgeToCurrentMs = (
  snapshotGeneratedAt: string | undefined,
  rawAgeMs: unknown,
  now: number,
): number | undefined => {
  const baseAge = toMs(rawAgeMs)
  if (baseAge === undefined) {
    return undefined
  }

  const generatedAtMs = snapshotGeneratedAt ? Date.parse(snapshotGeneratedAt) : Number.NaN
  if (!Number.isFinite(generatedAtMs)) {
    return Math.max(0, baseAge)
  }

  return Math.max(0, now - generatedAtMs + baseAge)
}

export const fetchOfficeInstancesPayload = async () => {
  const sessions = await commandToOfficeResponse()
  const snapshot = await readSnapshotPayload()
  const now = Date.now()
  const liveNormalized = sessions.filter((item) => OFFICE_TARGET_KEYS.includes(item.key as (typeof OFFICE_TARGET_KEYS)[number]))
  const snapshotNormalized = Array.isArray(snapshot?.instances)
    ? snapshot.instances.filter((item) => OFFICE_TARGET_KEYS.includes(item.key as (typeof OFFICE_TARGET_KEYS)[number]))
    : []
  const liveMap = new Map(
    liveNormalized
      .filter((item): item is (typeof liveNormalized)[number] & { key: (typeof OFFICE_TARGET_KEYS)[number] } =>
        Boolean(item.key),
      )
      .map((item) => [item.key, item]),
  )
  const snapshotMap = new Map(
    snapshotNormalized
      .filter((item): item is (typeof snapshotNormalized)[number] & { key: (typeof OFFICE_TARGET_KEYS)[number] } =>
        Boolean(item.key),
      )
      .map((item) => [item.key, item]),
  )

  const instances = OFFICE_TARGET_KEYS.map((key) => {
    const liveItem = liveMap.get(key)
    const snapshotItem = snapshotMap.get(key)
    const fallbackAge = snapshotAgeToCurrentMs(snapshot?.generatedAt, snapshotItem?.ageMs, now)
    const safeAge = Math.max(0, typeof liveItem?.ageMs === 'number' ? liveItem.ageMs : fallbackAge ?? 8 * 60 * 60 * 1000)
    const current = liveItem ?? snapshotItem
    const usingSnapshotFallback = !liveItem && Boolean(snapshotItem)

    return {
      key,
      name: current?.name || `实例 ${key}`,
      role: current?.role || OFFICE_ROLE_MAP[key],
      status: statusByAge(safeAge),
      task: inferTaskSummary({
        task: current?.task,
        currentTask: current?.currentTask,
        sessionKeyRaw: current?.sessionKeyRaw,
        kind: current?.kind,
        model: current?.model,
        ...(current ? {} : { slotKey: key }),
      } as SessionItem),
      updatedAt:
        liveItem?.ageText ||
        liveItem?.updatedAt ||
        (usingSnapshotFallback
          ? `snapshot ${snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '已缓存'}`
          : `超过 ${Math.max(1, Math.round(safeAge / 60000))} 分钟未见会话上报`),
      ageMs: safeAge,
      ageText:
        liveItem?.ageText ||
        liveItem?.updatedAt ||
        (usingSnapshotFallback
          ? `snapshot ${snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '已缓存'}`
          : `超过 ${Math.max(1, Math.round(safeAge / 60000))} 分钟未见会话上报`),
      note: liveItem
        ? safeAge <= 5 * 60 * 1000
          ? `最近 ${Math.max(1, Math.round(safeAge / 1000))} 秒有状态上报`
          : `上次上报于 ${Math.max(1, Math.round(safeAge / 60000))} 分钟前`
        : usingSnapshotFallback
          ? `当前缺少 live session，暂用 snapshot(${snapshot?.generatedAt || 'unknown'}) 兜底`
          : '当前无 live session，也没有可用 snapshot 记录',
      projectRelated: current?.projectRelated || OFFICE_PROJECT_RELATED_MAP[key] || 'KOTOVELA 协同项目',
    }
  })

  return {
    source: sessions.length > 0 ? 'live' : snapshot?.source || 'snapshot',
    generatedAt: new Date(now).toISOString(),
    snapshotGeneratedAt: snapshot?.generatedAt,
    instances,
  }
}

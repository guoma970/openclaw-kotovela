import { exec as execCommand } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OFFICE_TARGET_KEYS = ['main', 'builder', 'media', 'family', 'business', 'personal']

const OFFICE_ROLE_MAP = {
  main: '中枢调度',
  builder: '研发执行',
  media: '内容助手',
  family: '家庭助手',
  business: '业务助手',
  personal: '个人助手',
  ztl970: '个人助手',
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const snapshotPath = path.resolve(
  process.env.OFFICE_SNAPSHOT_OUTPUT_PATH || path.resolve(__dirname, '../data/office-instances.snapshot.json'),
)

const toMs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  return undefined
}

const normalizeSessionKey = (value) => {
  if (typeof value !== 'string') {
    return ''
  }

  const trimmed = value.trim()
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

const parseSessionOutput = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return []
  }

  const rawList = raw?.data?.instances ?? raw?.instances
  const sessionList = raw?.data?.sessions ?? raw?.sessions
  const list = Array.isArray(rawList) ? rawList : Array.isArray(sessionList) ? sessionList : []

  if (!Array.isArray(list)) {
    return []
  }

  const mapped = list
    .filter((item) => typeof item === 'object' && item !== null)
    .map((item) => ({
      ...item,
      key: normalizeSessionKey(item.key),
      updatedAt: typeof item.ageMs === 'number' ? `最近 ${Math.max(1, Math.round(item.ageMs / 1000))} 秒` : item.updatedAt,
    }))

  const deduped = {}
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

const buildSnapshotItem = (session) => {
  const key = String(session.key || '').trim()
  const ageMs = toMs(session.ageMs) ?? 0
  const updatedAt = session.ageText || (typeof session.updatedAt === 'string' ? session.updatedAt : '刚刚')

  return {
    key,
    name: session.name || key || '未知实例',
    role: session.role || OFFICE_ROLE_MAP[key] || '未设置角色',
    status: typeof session.status === 'string' && session.status.length > 0 ? session.status : 'active',
    task: typeof session.task === 'string' && session.task.length > 0 ? session.task : session.currentTask || '暂无任务',
    updatedAt,
    ageMs,
    ageText: updatedAt,
  }
}

const runCommand = () =>
  new Promise((resolve, reject) => {
    execCommand(
      'openclaw --log-level silent sessions --json --all-agents --active 240',
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout) {
          reject(error || new Error('No stdout from openclaw sessions'))
          return
        }

        try {
          const parsed = JSON.parse(stdout)
          const sessions = parseSessionOutput(parsed)
          resolve(sessions)
        } catch (parseError) {
          reject(parseError)
        }
      },
    )
  })

const main = async () => {
  const sessions = await runCommand()
  const instances = sessions
    .filter((item) => OFFICE_TARGET_KEYS.includes(item.key))
    .map(buildSnapshotItem)

  const payload = {
    source: 'snapshot',
    generatedAt: new Date().toISOString(),
    instances,
  }

  await mkdir(path.dirname(snapshotPath), { recursive: true })
  await writeFile(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  process.stdout.write(`Wrote snapshot: ${snapshotPath}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})

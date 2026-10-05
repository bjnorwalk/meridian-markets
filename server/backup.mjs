import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const DATA_DIR = process.env.DATA_DIR ?? resolve(process.cwd(), 'data')
const BACKUP_DIR = process.env.BACKUP_DIR ?? resolve(DATA_DIR, 'backups')
const MAX_BACKUPS = Number(process.env.MAX_DB_BACKUPS || '10')

function ensureBackupDir() {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })
}

function pruneOldBackups() {
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .sort()
    .reverse()
  for (const old of files.slice(MAX_BACKUPS)) {
    unlinkSync(resolve(BACKUP_DIR, old))
  }
}

export function createDbBackup() {
  ensureBackupDir()
  const dbPath = resolve(DATA_DIR, 'market.db')
  if (!existsSync(dbPath)) return { ok: false, reason: 'No database file found' }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(BACKUP_DIR, `market-${timestamp}.db`)
  copyFileSync(dbPath, backupPath)
  pruneOldBackups()
  return { ok: true, path: backupPath }
}

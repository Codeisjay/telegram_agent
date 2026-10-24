import { DatabaseSync } from 'node:sqlite'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg
const source = process.argv[2] ? path.resolve(process.argv[2]) : ''
const tableOrder = [
  'candidate_profile',
  'job_settings',
  'scheduler_state',
  'search_runs',
  'jobs',
  'source_page_cache',
  'company_search_runs',
  'provider_usage',
  'job_sources',
  'job_page_cache',
  'job_notifications',
  'job_applications',
]

if (!process.argv[2]) {
  throw new Error('Usage: node import-sqlite-to-postgres.mjs <path-to-jobs.sqlite>')
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to import SQLite data.')
}
const sourceStat = await stat(source)
if (!sourceStat.isFile()) throw new Error('The SQLite database path must point to a file.')

const sqlite = new DatabaseSync(source)
sqlite.exec('PRAGMA query_only = ON')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,
})

try {
  const sqliteTables = new Set(sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  ).all().map((row) => row.name))
  for (const table of tableOrder) {
    if (!sqliteTables.has(table)) throw new Error(`The SQLite database is missing expected table "${table}".`)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [731092482])

    for (const table of tableOrder) {
      const count = await client.query(`SELECT COUNT(*)::bigint AS count FROM "${table}"`)
      if (Number(count.rows[0].count) !== 0) {
        throw new Error(`PostgreSQL table "${table}" is not empty; import stopped without overwriting data.`)
      }
    }

    const expected = {}
    for (const table of tableOrder) {
      const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name)
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all()
      expected[table] = rows.length
      if (!rows.length) continue

      const columnSql = columns.map((column) => `"${column}"`).join(', ')
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
      const insert = `INSERT INTO "${table}" (${columnSql}) VALUES (${placeholders})`
      for (const row of rows) {
        await client.query(insert, columns.map((column) => row[column]))
      }
    }

    for (const table of tableOrder) {
      const idColumn = table === 'candidate_profile' || table === 'job_settings' || table === 'scheduler_state'
        ? null
        : 'id'
      if (!idColumn) continue
      const sequence = await client.query('SELECT pg_get_serial_sequence($1, $2) AS name', [table, idColumn])
      const sequenceName = sequence.rows[0].name
      if (sequenceName) {
        await client.query(
          `SELECT setval($1::regclass, COALESCE((SELECT MAX("${idColumn}") FROM "${table}"), 1), EXISTS (SELECT 1 FROM "${table}"))`,
          [sequenceName],
        )
      }
    }

    const verified = {}
    for (const table of tableOrder) {
      const count = await client.query(`SELECT COUNT(*)::bigint AS count FROM "${table}"`)
      verified[table] = Number(count.rows[0].count)
      if (verified[table] !== expected[table]) {
        throw new Error(`Row-count verification failed for "${table}": expected ${expected[table]}, got ${verified[table]}.`)
      }
    }
    await client.query('COMMIT')
    console.log(JSON.stringify({ imported: verified, sourceUnchanged: true }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
} finally {
  sqlite.close()
  await pool.end()
}

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations', 'postgres')

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run PostgreSQL migrations.')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,
})

try {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [731092481])
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`)

    const files = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{3}_.+\.sql$/.test(file))
      .sort()
    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version))

    for (const file of files) {
      const version = Number(file.slice(0, 3))
      if (applied.has(version)) continue
      const sql = await readFile(path.join(migrationsDirectory, file), 'utf8')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations(version, applied_at) VALUES ($1, $2)', [
        version,
        new Date().toISOString(),
      ])
      console.log(`Applied PostgreSQL migration ${file}`)
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}

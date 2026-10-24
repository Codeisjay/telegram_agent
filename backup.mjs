import { access, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { JobDatabase } from './job-intelligence.mjs'

const dataDirectory = process.env.AGENTFLOW_DATA_DIR
  || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'AgentFlow')
    : path.join(homedir(), '.config', 'agentflow'))
const source = path.resolve(process.env.AGENTFLOW_DB_PATH || path.join(dataDirectory, 'jobs.sqlite'))
const destinationInput = process.argv[2]

if (!destinationInput) throw new Error('Usage: node backup.mjs <new-backup-file>')

const destination = path.resolve(destinationInput)
if (destination === source) throw new Error('Backup destination must differ from the active database.')
try {
  await access(destination)
  throw new Error(`Backup destination already exists: ${destination}`)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

await mkdir(path.dirname(destination), { recursive: true })
const database = await JobDatabase.open(source)
try {
  await database.backupTo(destination)
  console.log(`SQLite backup created at ${destination}`)
} finally {
  database.close()
}

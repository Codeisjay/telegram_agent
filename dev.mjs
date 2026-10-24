import { spawn } from 'node:child_process'

let serverProcess
let viteProcess
let shuttingDown = false

function stopChildren() {
  if (shuttingDown) return
  shuttingDown = true
  serverProcess?.kill()
  viteProcess?.kill()
}

function fail(message) {
  console.error(message)
  stopChildren()
  process.exitCode = 1
}

serverProcess = spawn(process.execPath, ['server.mjs'], {
  stdio: ['inherit', 'pipe', 'inherit'],
  env: process.env,
})

let serverReady = false
serverProcess.stdout.on('data', (chunk) => {
  const output = chunk.toString()
  process.stdout.write(output)
  const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
  if (!match || serverReady) return
  serverReady = true
  viteProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
    stdio: 'inherit',
    env: { ...process.env, AGENTFLOW_PORT: match[1] },
  })
  viteProcess.on('error', (error) => fail(`Could not start Vite: ${error.message}`))
  viteProcess.on('exit', (code) => {
    if (!shuttingDown) {
      serverProcess.kill()
      process.exitCode = code || 0
    }
  })
})

serverProcess.on('error', (error) => fail(`Could not start the local API server: ${error.message}`))
serverProcess.on('exit', (code) => {
  if (!shuttingDown && code !== 0) {
    viteProcess?.kill()
    process.exitCode = code || 1
  }
})

process.on('SIGINT', stopChildren)
process.on('SIGTERM', stopChildren)

import { nextDailyRun } from './job-intelligence.mjs'

export class DailyScheduler {
  constructor({ database, run, onError = () => {}, intervalMs = 30000, maxRetries = 2, retryDelayMs = 1000 }) {
    this.database = database
    this.run = run
    this.onError = onError
    this.intervalMs = intervalMs
    this.maxRetries = maxRetries
    this.retryDelayMs = retryDelayMs
    this.timer = null
    this.running = false
    this.started = false
  }

  async start() {
    if (this.started) return
    this.started = true
    const interruptedRuns = this.database.recoverInterruptedRuns()
    if (interruptedRuns > 0) this.database.setNextRun(new Date().toISOString())
    await this.tick(true)
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.onError(error))
    }, this.intervalMs)
    this.timer.unref?.()
  }

  async tick(recoverMissed = false, now = new Date()) {
    if (this.running) return { status: 'overlap-skipped' }
    const schedule = this.database.getScheduler()
    if (schedule.paused) return { status: 'paused' }
    if (!schedule.next_run_at || new Date(schedule.next_run_at).getTime() > now.getTime()) return { status: 'not-due' }

    if (recoverMissed) this.database.markMissedRun()
    this.database.setNextRun(nextDailyRun(now))
    this.running = true
    try {
      let lastError
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const trigger = recoverMissed ? 'schedule-recovery' : 'daily-schedule'
          await this.run(attempt ? `${trigger}-retry-${attempt}` : trigger)
          return { status: 'completed', attempts: attempt + 1 }
        } catch (error) {
          lastError = error
          if (attempt < this.maxRetries && this.retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * (2 ** attempt)))
          }
        }
      }
      this.onError(lastError)
      return { status: 'failed', attempts: this.maxRetries + 1, error: lastError }
    } finally {
      this.running = false
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.started = false
  }
}

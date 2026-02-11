import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface ComposeService {
  enableModule(profile: string, composePath?: string): Promise<{ stdout: string; stderr: string }>
  disableModule(profile: string, composePath?: string): Promise<{ stdout: string; stderr: string }>
}

export function createComposeService(): ComposeService {
  return {
    async enableModule(
      profile: string,
      composePath?: string,
    ): Promise<{ stdout: string; stderr: string }> {
      const fileArg = composePath ? `-f ${composePath}` : ''
      const cmd = `docker compose ${fileArg} --profile ${profile} up -d`
      return execAsync(cmd, { timeout: 120_000 })
    },

    async disableModule(
      profile: string,
      composePath?: string,
    ): Promise<{ stdout: string; stderr: string }> {
      const fileArg = composePath ? `-f ${composePath}` : ''
      const cmd = `docker compose ${fileArg} --profile ${profile} stop`
      return execAsync(cmd, { timeout: 60_000 })
    },
  }
}

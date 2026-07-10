import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getComposePath } from './compose-path.js'

/**
 * Upsert a KEY=value line in ~/.jarvis/compose/.env — the file that native
 * macOS services source (Docker services read it too). Returns false if the
 * .env doesn't exist yet (install hasn't generated it).
 *
 * This is the reliable way to configure native services that build their venvs
 * asynchronously (via launchd) after install and so aren't reachable over HTTP
 * when the wizard's Models step runs. Services read these as settings
 * env-fallbacks and, on a fresh install, seed_settings picks them up.
 */
export function upsertEnvVar(key: string, value: string): boolean {
  const envPath = join(getComposePath(), '.env')
  if (!existsSync(envPath)) return false
  let content = readFileSync(envPath, 'utf-8')
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  content = re.test(content)
    ? content.replace(re, line)
    : `${content.replace(/\n?$/, '\n')}${line}\n`
  writeFileSync(envPath, content)
  return true
}

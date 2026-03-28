import { createWriteStream, existsSync, renameSync, chmodSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform, arch } from 'node:os'
import { execSync, spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const REPO = 'alexberardi/jarvis-admin'

type Emit = (data: Record<string, unknown>) => void

function detectBinaryName(): string {
  const os = platform()
  const a = arch()
  if (os === 'darwin' && a === 'arm64') return 'jarvis-admin-darwin-arm64'
  if (os === 'linux' && a === 'x64') return 'jarvis-admin-linux-x64'
  if (os === 'linux' && a === 'arm64') return 'jarvis-admin-linux-arm64'
  throw new Error(`Unsupported platform: ${os}-${a}`)
}

function getBinDir(): string {
  return join(homedir(), '.jarvis', 'bin')
}

function getMarkerPath(): string {
  return join(homedir(), '.jarvis', 'upgrade-in-progress.json')
}

/**
 * Download new binary + assets, atomic swap, write upgrade marker, restart.
 */
export async function selfUpdate(targetVersion: string, emit: Emit): Promise<void> {
  const binDir = getBinDir()
  const binaryName = detectBinaryName()
  const tag = `v${targetVersion}`

  // Download new binary
  emit({ phase: 'download', message: `Downloading ${binaryName}...` })
  const binaryUrl = `https://github.com/${REPO}/releases/download/${tag}/${binaryName}`
  const newBinaryPath = join(binDir, 'jarvis-admin.new')
  await downloadFile(binaryUrl, newBinaryPath)
  chmodSync(newBinaryPath, 0o755)

  // Download new frontend assets
  emit({ phase: 'download', message: 'Downloading frontend assets...' })
  const publicUrl = `https://github.com/${REPO}/releases/download/${tag}/public.tar.gz`
  const tarPath = join(binDir, 'public.tar.gz')
  await downloadFile(publicUrl, tarPath)

  // Extract to public.new/
  const publicNewDir = join(binDir, 'public.new')
  mkdirSync(publicNewDir, { recursive: true })
  execSync(`tar xzf ${tarPath} -C ${publicNewDir} --strip-components=1`, { stdio: 'pipe' })

  // Atomic swap
  emit({ phase: 'binary', message: 'Swapping binary...' })
  const currentBinary = join(binDir, 'jarvis-admin')
  const oldBinary = join(binDir, 'jarvis-admin.old')
  const publicDir = join(binDir, 'public')
  const publicOld = join(binDir, 'public.old')

  // Binary swap
  if (existsSync(oldBinary)) renameSync(oldBinary, join(binDir, 'jarvis-admin.prev'))
  if (existsSync(currentBinary)) renameSync(currentBinary, oldBinary)
  renameSync(newBinaryPath, currentBinary)

  // Public assets swap
  if (existsSync(publicOld)) execSync(`rm -rf ${publicOld}`, { stdio: 'pipe' })
  if (existsSync(publicDir)) renameSync(publicDir, publicOld)
  renameSync(publicNewDir, publicDir)

  // Clean up tarball
  if (existsSync(tarPath)) execSync(`rm -f ${tarPath}`, { stdio: 'pipe' })

  // Write upgrade marker so the new binary continues the upgrade after restart
  writeFileSync(getMarkerPath(), JSON.stringify({
    version: targetVersion,
    phase: 'binary-updated',
    startedAt: new Date().toISOString(),
  }))

  // Tell the client we're about to restart
  emit({ phase: 'binary', message: 'Binary updated. Restarting...', restart: true })

  // Trigger restart via service manager
  triggerRestart()
}

function triggerRestart(): void {
  const os = platform()

  if (os === 'linux') {
    // systemd user service
    try {
      const child = spawn('systemctl', ['--user', 'restart', 'jarvis-admin'], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      return
    } catch {
      // fallback below
    }
  }

  if (os === 'darwin') {
    // launchd
    try {
      const uid = execSync('id -u', { encoding: 'utf-8' }).trim()
      const child = spawn('launchctl', ['kickstart', '-k', `gui/${uid}/com.jarvis.admin`], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      return
    } catch {
      // fallback below
    }
  }

  // Fallback: exit and let the service manager restart us
  setTimeout(() => process.exit(0), 500)
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(300_000), // 5 min timeout
  })

  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} for ${url}`)
  }

  const fileStream = createWriteStream(destPath)
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), fileStream)
}

/** Check if an upgrade was interrupted and needs to resume. */
export function getUpgradeMarker(): { version: string; phase: string; startedAt: string } | null {
  const path = getMarkerPath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(require('node:fs').readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/** Remove the upgrade marker after successful completion. */
export function clearUpgradeMarker(): void {
  const path = getMarkerPath()
  if (existsSync(path)) {
    require('node:fs').unlinkSync(path)
  }
}

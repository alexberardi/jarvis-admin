/**
 * Service URLs must be saved even when some services fail their health check.
 *
 * A Windows user's install left admin with no URLs at all, and every
 * authenticated endpoint then answered 502:
 *
 *   [jarvis-admin] Could not resolve service URLs from config-service at :
 *     fetch() URL is invalid. Using defaults.
 *   [jarvis-admin] Service URLs: auth=, config=, llm=, cc=
 *   [requireSuperuser] Auth service error (authUrl=):
 *     TypeError: fetch() URL is invalid  code: ERR_INVALID_URL
 *   GET /api/system/info → 502
 *
 * auth and config-service were both HEALTHY in that install. What failed were
 * go2rtc, phone-gateway, llm-proxy and the admin container -- and because
 * persistence was gated on every service passing, nothing was written. The
 * wizard's own Models step then could not authenticate, which is where they
 * gave up; reinstalling repeated it, because the same optional services failed.
 *
 * The URLs are derived from the ports the install just generated. They are
 * configuration, not an observation, so health has no bearing on whether they
 * are worth recording.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceUrlsFromPorts } from '../../src/config.js'

describe('serviceUrlsFromPorts', () => {
  it('uses the standard ports when the install did not override them', () => {
    expect(serviceUrlsFromPorts({})).toEqual({
      authUrl: 'http://localhost:7701',
      configServiceUrl: 'http://localhost:7700',
      llmProxyUrl: 'http://localhost:7704',
      commandCenterUrl: 'http://localhost:7703',
    })
  })

  it('honours overridden ports', () => {
    const urls = serviceUrlsFromPorts({
      AUTH_PORT: '18701',
      CONFIG_SERVICE_PORT: '18700',
      LLM_PROXY_API_PORT: '18704',
      COMMAND_CENTER_PORT: '18703',
    })
    expect(urls.authUrl).toBe('http://localhost:18701')
    expect(urls.configServiceUrl).toBe('http://localhost:18700')
    expect(urls.llmProxyUrl).toBe('http://localhost:18704')
    expect(urls.commandCenterUrl).toBe('http://localhost:18703')
  })

  it('never yields an empty URL, whatever it is handed', () => {
    // An empty string is the one value that cannot be recovered from: fetch()
    // throws ERR_INVALID_URL, which requireSuperuser reports as
    // "Auth service unavailable" for every request forever.
    for (const urls of [serviceUrlsFromPorts({}), serviceUrlsFromPorts({ AUTH_PORT: '' })]) {
      for (const [key, value] of Object.entries(urls)) {
        expect(value, key).toMatch(/^http:\/\/localhost:\d+$/)
      }
    }
  })
})

describe('the install route', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', '..', 'src', 'routes', 'install.ts'),
    'utf-8',
  )

  it('persists the URLs without waiting for every service to be healthy', () => {
    // The regression, as it was written:
    //     if (result.success) { ... savePersistedConfig(urls) }
    // A source check because the surrounding handler is an SSE stream that
    // shells out to docker compose; there is no way to drive it in a unit test,
    // and the thing worth pinning is that the call is not inside that gate.
    expect(source).not.toMatch(/if \(result\.success\)\s*\{[\s\S]{0,600}savePersistedConfig\(urls\)/)
    expect(source).toMatch(/savePersistedConfig\(urls\)/)
  })

  it('still gates the INSTALLED marker on success', () => {
    // Recording "installed" when services failed would skip the wizard on the
    // next launch and strand the user in a broken dashboard. Only the URLs are
    // unconditional.
    expect(source).toMatch(/if \(result\.success && redirect\)\s*\{[\s\S]{0,200}savePersistedConfig\(\{ installed: true \}\)/)
  })
})

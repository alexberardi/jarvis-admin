import type { FastifyRequest, FastifyReply } from 'fastify'

export interface AuthUser {
  id: number
  email: string
  username?: string
  is_superuser: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser
  }
}

export async function requireSuperuser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid authorization header' })
    return
  }

  const token = authHeader.slice(7)
  const authUrl = request.server.config.authUrl

  try {
    const response = await fetch(`${authUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      reply.code(401).send({ error: 'Invalid or expired token' })
      return
    }

    const user = (await response.json()) as AuthUser

    if (!user.is_superuser) {
      reply.code(403).send({ error: 'Superuser access required' })
      return
    }

    request.user = user
  } catch (err) {
    console.error(`[requireSuperuser] Auth service error (authUrl=${authUrl}):`, err)
    reply.code(502).send({ error: 'Auth service unavailable' })
  }
}

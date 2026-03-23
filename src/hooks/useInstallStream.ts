import { useState, useCallback, useRef } from 'react'

export interface StreamLine {
  stream: 'stdout' | 'stderr'
  text: string
  timestamp: number
}

export interface StreamState {
  lines: StreamLine[]
  running: boolean
  done: boolean
  exitCode: number | null
  error: string | null
}

/**
 * Hook for consuming SSE streams from install endpoints (pull, start).
 */
export function useInstallStream() {
  const [state, setState] = useState<StreamState>({
    lines: [],
    running: false,
    done: false,
    exitCode: null,
    error: null,
  })
  const eventSourceRef = useRef<EventSource | null>(null)

  const start = useCallback((url: string) => {
    // Clean up any existing connection
    eventSourceRef.current?.close()

    setState({
      lines: [],
      running: true,
      done: false,
      exitCode: null,
      error: null,
    })

    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as
          | { stream: 'stdout' | 'stderr'; text: string }
          | { done: true; code: number }

        if ('done' in data) {
          setState((prev) => ({
            ...prev,
            running: false,
            done: true,
            exitCode: data.code,
          }))
          es.close()
          return
        }

        const line: StreamLine = {
          stream: data.stream,
          text: data.text,
          timestamp: Date.now(),
        }

        setState((prev) => ({
          ...prev,
          lines: [...prev.lines, line],
        }))
      } catch {
        // Ignore parse errors
      }
    }

    es.onerror = () => {
      setState((prev) => ({
        ...prev,
        running: false,
        error: prev.done ? null : 'Connection lost',
      }))
      es.close()
    }
  }, [])

  const stop = useCallback(() => {
    eventSourceRef.current?.close()
    setState((prev) => ({ ...prev, running: false }))
  }, [])

  return { ...state, start, stop }
}

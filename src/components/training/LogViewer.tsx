import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PipelineState } from '@/types/training'

interface LogViewerProps {
  pipelineState: PipelineState
}

export default function LogViewer({ pipelineState }: LogViewerProps) {
  const [logs, setLogs] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const autoScrollRef = useRef(true)

  const connectSSE = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    setLogs([])
    setConnected(true)

    const es = new EventSource('/api/training/logs')
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.done) {
          es.close()
          setConnected(false)
          return
        }
        if (data.line) {
          setLogs((prev) => [...prev, data.line])
        }
      } catch {
        // Ignore parse errors
      }
    }

    es.onerror = () => {
      es.close()
      setConnected(false)
    }
  }, [])

  // Connect when pipeline starts running
  useEffect(() => {
    if (pipelineState === 'running') {
      connectSSE()
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [pipelineState, connectSSE])

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs])

  function handleScroll() {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    // If user scrolled up more than 50px from bottom, disable auto-scroll
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <Terminal size={14} className="text-[var(--color-text-muted)]" />
        <span className="text-sm font-semibold text-[var(--color-text)]">Logs</span>
        {connected && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-green-500">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Live
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={cn(
          'h-72 overflow-y-auto bg-[var(--color-bg)] p-3 font-mono text-xs leading-relaxed',
          'text-[var(--color-text-muted)]',
        )}
      >
        {logs.length === 0 ? (
          <p className="py-8 text-center text-[var(--color-text-muted)]">
            {pipelineState === 'running'
              ? 'Waiting for log output...'
              : 'Logs will appear here when a pipeline runs.'}
          </p>
        ) : (
          logs.map((line, i) => (
            <div key={i} className={cn(getLineColor(line))}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function getLineColor(line: string): string {
  if (line.startsWith('[pipeline] Completed') || line.includes('All steps completed')) {
    return 'text-green-400'
  }
  if (line.startsWith('[pipeline] Failed') || line.startsWith('[pipeline] Error')) {
    return 'text-red-400'
  }
  if (line.startsWith('[pipeline] Starting') || line.startsWith('[pipeline]')) {
    return 'text-[var(--color-primary)]'
  }
  return ''
}

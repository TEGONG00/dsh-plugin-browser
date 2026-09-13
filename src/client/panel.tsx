import { useCallback, useEffect, useRef, useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import {
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ElementPick } from './element-refs.ts'

interface BrowserStatus {
  url: string
  title: string
  viewport: { width: number; height: number }
}

export interface BrowserPanelInjected {
  /** Insert one picked element as a composer reference chip (元素N). */
  insertElement: (pick: ElementPick) => string
}

interface BrowserPanelProps {
  useTabInfo: () => {
    tab: { visible: boolean; active: unknown }
  }
  insertElement: (pick: ElementPick) => string
}

/**
 * Ghost icon buttons in the visual language of the shell's collapse-sidebar
 * button: borderless, transparent, tinted hover. `color-mix(currentColor)`
 * adapts to light/dark themes; a tiny namespaced <style> block carries the
 * hover/active states that inline styles cannot express.
 */
const PANEL_STYLES = `
.dsh-browser-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 26px; min-width: 26px; padding: 0; border: none; border-radius: 6px;
  background: transparent; color: inherit; cursor: pointer;
  font-size: 12px; line-height: 1;
}
.dsh-browser-btn:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 10%, transparent)); }
.dsh-browser-btn:active { background: color-mix(in srgb, currentColor 16%, transparent); }
.dsh-browser-btn:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 35%, transparent); outline-offset: -2px; }
.dsh-browser-btn[data-on="1"] {
  color: #3b82f6; font-weight: 600;
  background: color-mix(in srgb, #3b82f6 12%, transparent);
}
.dsh-browser-url {
  flex: 1; min-width: 80px; height: 26px; font-size: 12px; padding: 0 8px;
  border: none; border-radius: 6px; background: transparent; color: inherit;
}
.dsh-browser-url:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
.dsh-browser-url:focus { outline: none; background: color-mix(in srgb, currentColor 8%, transparent); }
.dsh-browser-url::placeholder { color: color-mix(in srgb, currentColor 45%, transparent); }
`

async function postCommand(command: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch('/dsh-browser/api/cmd', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  return await response.json() as Record<string, unknown>
}

export function BrowserPanel(props: BrowserPanelProps): React.ReactNode {
  const { insertElement } = props
  const { tab } = props.useTabInfo()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scaleRef = useRef({ width: 1280, height: 800 })
  const [status, setStatus] = useState<BrowserStatus | null>(null)
  const [connected, setConnected] = useState(false)
  const [picking, setPicking] = useState(false)
  const [notice, setNotice] = useState('')
  const [urlDraft, setUrlDraft] = useState('')

  const drawFrame = useCallback((base64: string) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const image = new Image()
    image.onload = () => {
      if (canvasRef.current !== canvas) return
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      scaleRef.current = { width: image.naturalWidth, height: image.naturalHeight }
      const context = canvas.getContext('2d')
      context?.drawImage(image, 0, 0)
    }
    image.src = `data:image/jpeg;base64,${base64}`
  }, [])

  const handlePick = useCallback((pick: ElementPick) => {
    try {
      const label = insertElement(pick)
      setNotice(`${label} 已插入输入框，像引用文件一样在句子里引用它`)
    } catch (error) {
      setNotice(`插入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [insertElement])

  useEffect(() => {
    if (!tab.visible) return undefined
    const source = new EventSource('/dsh-browser/api/stream')
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.addEventListener('status', (event) => {
      const next = JSON.parse((event as MessageEvent).data) as BrowserStatus
      setStatus(next)
      setUrlDraft(next.url)
    })
    source.addEventListener('frame', (event) => {
      drawFrame((event as MessageEvent).data as string)
    })
    source.addEventListener('pick', (event) => {
      handlePick(JSON.parse((event as MessageEvent).data) as ElementPick)
    })
    return () => {
      source.close()
      setConnected(false)
    }
  }, [tab.visible, drawFrame, handlePick])

  // Native non-passive wheel forwarder so the panel itself never scrolls.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const scale = scaleRef.current.width / rect.width
      void postCommand({ type: 'input', kind: 'wheel', dx: event.deltaX * scale, dy: event.deltaY * scale })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [tab.visible])

  const toPageCoords = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = scaleRef.current.width / rect.width
    const scaleY = scaleRef.current.height / rect.height
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY }
  }

  const togglePick = async () => {
    const next = !picking
    setPicking(next)
    setNotice(next ? '选择模式：点击页面元素，会以「元素N」引用插入输入框' : '')
    await postCommand({ type: 'pick', enabled: next })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const forwardedKeys = ['Enter', 'Backspace', 'Delete', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key.length === 1) {
      event.preventDefault()
      void postCommand({ type: 'input', kind: 'type', text: event.key })
      return
    }
    if (forwardedKeys.includes(event.key)) {
      event.preventDefault()
      void postCommand({ type: 'input', kind: 'key', key: event.key })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: 12 }}>
      <style>{PANEL_STYLES}</style>
      <div style={{ display: 'flex', gap: 2, alignItems: 'center', padding: '4px 6px', flexWrap: 'wrap' }}>
        <button
          type="button" className="dsh-browser-btn" title="后退"
          onClick={() => void postCommand({ type: 'back' })}
        >
          <IconChevronLeftOutline14 size={14} />
        </button>
        <button
          type="button" className="dsh-browser-btn" title="前进"
          onClick={() => void postCommand({ type: 'forward' })}
        >
          <IconChevronRightOutline14 size={14} />
        </button>
        <button
          type="button" className="dsh-browser-btn" title="刷新"
          onClick={() => void postCommand({ type: 'reload' })}
        >
          <IconRefreshOutline16 size={14} />
        </button>
        <input
          className="dsh-browser-url"
          value={urlDraft}
          placeholder="输入网址后回车"
          onChange={(event) => setUrlDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void postCommand({ type: 'navigate', url: urlDraft })
          }}
        />
        <button
          type="button"
          className="dsh-browser-btn"
          data-on={picking ? '1' : '0'}
          title="选择元素，以「元素N」引用插入输入框"
          style={{ padding: '0 8px' }}
          onClick={() => void togglePick()}
        >
          <MousePointerClick size={14} />
          <span>{picking ? '选择中' : '选择元素'}</span>
        </button>
      </div>
      {notice ? (
        <div style={{ margin: '0 6px 4px', padding: '4px 8px', borderRadius: 6, background: 'color-mix(in srgb, currentColor 8%, transparent)', color: 'inherit' }}>
          {notice}
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseMove={(event) => {
            const { x, y } = toPageCoords(event)
            void postCommand({ type: 'input', kind: 'move', x, y })
          }}
          onClick={(event) => {
            const { x, y } = toPageCoords(event)
            void postCommand({ type: 'input', kind: 'click', x, y })
          }}
          onDoubleClick={(event) => {
            const { x, y } = toPageCoords(event)
            void postCommand({ type: 'input', kind: 'dblclick', x, y })
          }}
          style={{
            width: '100%', height: 'auto', display: 'block',
            outline: picking ? '2px solid #3b82f6' : 'none',
            cursor: picking ? 'crosshair' : 'default',
            background: 'color-mix(in srgb, currentColor 12%, transparent)',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '3px 6px', opacity: 0.75, alignItems: 'center' }}>
        <span
          style={{
            width: 7, height: 7, borderRadius: 999, flexShrink: 0,
            background: connected ? '#22c55e' : 'color-mix(in srgb, currentColor 35%, transparent)',
          }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {status?.url
            ? `${status.title || status.url}`
            : connected ? '浏览器待启动：输入网址或让模型调用 browser_navigate' : '未连接（面板可见时自动连接）'}
        </span>
      </div>
    </div>
  )
}

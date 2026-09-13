import { useCallback, useEffect, useRef, useState } from 'react'
import { MousePointerClick, Upload, X } from 'lucide-react'
import {
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ComposerAttachment } from '@deepseek-ai/dsh-client-ui-conversation/client'

interface BrowserStatus {
  url: string
  title: string
  viewport: { width: number; height: number }
}

interface ElementPick extends Record<string, unknown> {
  tag: string
  id: string
  selector: string
  text: string
  outerHTML: string
  url: string
  title: string
  screenshotBase64: string
}

interface StagedElement {
  id: number
  pick: ElementPick
  thumbUrl: string
}

export interface BrowserPanelInjected {
  createDrafts: (files: readonly File[]) => readonly ComposerAttachment[]
}

interface BrowserPanelProps {
  useTabInfo: () => {
    tab: { visible: boolean; active: unknown }
  }
  inputActions: {
    addAttachments: (ids: readonly DraftAttachmentId[]) => boolean
    setDraft: (text: string) => void
  }
  useInput: <S>(selector: (state: { draft: string }) => S) => S
  createDrafts: (files: readonly File[]) => readonly ComposerAttachment[]
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
.dsh-browser-btn:disabled { opacity: 0.4; cursor: default; }
.dsh-browser-btn:disabled:hover { background: transparent; }
.dsh-browser-url {
  flex: 1; min-width: 80px; height: 26px; font-size: 12px; padding: 0 8px;
  border: none; border-radius: 6px; background: transparent; color: inherit;
}
.dsh-browser-url:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
.dsh-browser-url:focus { outline: none; background: color-mix(in srgb, currentColor 8%, transparent); }
.dsh-browser-url::placeholder, .dsh-browser-opinion::placeholder { color: color-mix(in srgb, currentColor 45%, transparent); }
.dsh-browser-opinion {
  flex: 1; min-width: 60px; height: 26px; font-size: 12px; padding: 0 8px;
  border: none; border-radius: 6px; background: color-mix(in srgb, currentColor 6%, transparent); color: inherit;
}
.dsh-browser-opinion:focus { outline: none; background: color-mix(in srgb, currentColor 10%, transparent); }
.dsh-browser-thumb {
  position: relative; flex: none; width: 44px; height: 34px; border-radius: 5px; overflow: hidden;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: color-mix(in srgb, currentColor 8%, transparent);
}
.dsh-browser-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dsh-browser-thumb-x {
  position: absolute; top: 0; right: 0; width: 14px; height: 14px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 0 0 0 4px; padding: 0; cursor: pointer;
  background: color-mix(in srgb, black 55%, transparent); color: #fff;
}
`

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return buffer
}

async function postCommand(command: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch('/dsh-browser/api/cmd', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  })
  return await response.json() as Record<string, unknown>
}

export function BrowserPanel(props: BrowserPanelProps): React.ReactNode {
  const { inputActions, useInput, createDrafts } = props
  const { tab } = props.useTabInfo()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scaleRef = useRef({ width: 1280, height: 800 })
  const stagedIdRef = useRef(0)
  const taskSeqRef = useRef(0)
  const [status, setStatus] = useState<BrowserStatus | null>(null)
  const [connected, setConnected] = useState(false)
  const [picking, setPicking] = useState(false)
  const [notice, setNotice] = useState('')
  const [urlDraft, setUrlDraft] = useState('')
  const [staged, setStaged] = useState<StagedElement[]>([])
  const [opinion, setOpinion] = useState('')
  const draftText = useInput((state) => state.draft)

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
    stagedIdRef.current += 1
    const entry: StagedElement = {
      id: stagedIdRef.current,
      pick,
      thumbUrl: `data:image/jpeg;base64,${pick.screenshotBase64}`,
    }
    setStaged((current) => [...current, entry])
    setNotice(`已暂存 <${pick.tag || 'element'}>，可继续选择；写好修改意见后点「上传任务」`)
  }, [])

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
    setNotice(next ? '选择模式：点击页面元素加入暂存区，可连续选择' : '')
    await postCommand({ type: 'pick', enabled: next })
  }

  const uploadTask = () => {
    if (staged.length === 0) return
    taskSeqRef.current += 1
    const taskNo = taskSeqRef.current
    const files: File[] = staged.map((entry, index) =>
      new File(
        [base64ToArrayBuffer(entry.pick.screenshotBase64)],
        `任务${taskNo}-${index + 1}-${entry.pick.tag || 'element'}.jpg`,
        { type: 'image/jpeg' },
      ))
    files.push(new File(
      [JSON.stringify({ task: taskNo, opinion, elements: staged.map((entry) => entry.pick) }, null, 2)],
      `任务${taskNo}.json`,
      { type: 'application/json' },
    ))
    const drafts = createDrafts(files)
    const added = inputActions.addAttachments(drafts.map((draft) => draft.id))
    const line = `任务${taskNo}：${opinion || '按附加的元素截图与信息修改'}`
    const base = draftText.trimEnd()
    const instruction = base.includes('请按任务编号顺序逐个完成')
      ? line
      : '请按任务编号顺序逐个完成以下修改任务：\n' + line
    inputActions.setDraft(base ? base + '\n' + instruction : instruction)
    setStaged([])
    setOpinion('')
    setNotice(added
      ? `任务${taskNo} 已加入对话框（${staged.length} 个元素）；可继续选择追加任务，发送后按序执行`
      : `任务${taskNo} 的文字已写入输入框，但附件暂不可用，请稍后重试`)
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
          title="选择元素加入暂存区"
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
      {staged.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, padding: '6px 6px 2px', flexWrap: 'wrap', alignItems: 'center' }}>
          {staged.map((entry) => (
            <div key={entry.id} className="dsh-browser-thumb" title={`<${entry.pick.tag}> ${entry.pick.selector}`}>
              <img src={entry.thumbUrl} alt={entry.pick.tag} />
              <button
                type="button"
                className="dsh-browser-thumb-x"
                title="移除"
                onClick={() => setStaged((current) => current.filter((item) => item.id !== entry.id))}
              >
                <X size={9} />
              </button>
            </div>
          ))}
          <span style={{ opacity: 0.7 }}>已暂存 {staged.length} 个元素</span>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 6px' }}>
        <input
          className="dsh-browser-opinion"
          value={opinion}
          placeholder={staged.length > 0 ? `对这 ${staged.length} 个元素的修改意见…` : '先点「选择元素」再选页面元素'}
          onChange={(event) => setOpinion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') uploadTask()
          }}
        />
        <button
          type="button"
          className="dsh-browser-btn"
          style={{ padding: '0 10px', border: '1px solid color-mix(in srgb, currentColor 20%, transparent)' }}
          disabled={staged.length === 0}
          title="把暂存元素与意见作为一个任务加入对话框"
          onClick={uploadTask}
        >
          <Upload size={13} />
          <span>上传任务{taskSeqRef.current > 0 ? `（下一个：任务${taskSeqRef.current + 1}）` : ''}</span>
        </button>
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

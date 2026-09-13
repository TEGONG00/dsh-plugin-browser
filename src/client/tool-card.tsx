import { useEffect, useState } from 'react'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/**
 * Keyed `tool.call.toolview` view for `browser_screenshot`: renders the
 * durable image the tool returned (the image block inside the settled
 * result content) through the session-authorized loader.
 */
export function ScreenshotToolView(props: ToolCallOwnerProps): React.ReactNode {
  const { block, loadImage } = props
  if (block.kind !== 'tool-result') {
    return <div style={{ fontSize: 12, opacity: 0.7, padding: '2px 0' }}>正在截图…</div>
  }
  if (block.isError) return null
  const imageBlock = block.content.find((part: { type: string }) => part.type === 'image') as
    | { type: 'image'; attachment: ImageAttachmentRef }
    | undefined
  if (!imageBlock) return null
  return <ScreenshotImage attachment={imageBlock.attachment} loadImage={loadImage} />
}

function ScreenshotImage(props: {
  attachment: ImageAttachmentRef
  loadImage: ((attachment: ImageAttachmentRef) => Promise<string>) & {
    peek?: (attachment: ImageAttachmentRef) => string | undefined
  }
}): React.ReactNode {
  const [url, setUrl] = useState<string | undefined>(props.loadImage.peek?.(props.attachment))
  useEffect(() => {
    let alive = true
    props.loadImage(props.attachment)
      .then((next) => {
        if (alive) setUrl(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [props.attachment, props.loadImage])
  if (!url) return <div style={{ fontSize: 12, opacity: 0.7 }}>截图加载中…</div>
  return (
    <img
      src={url}
      alt={`browser screenshot ${props.attachment.width}×${props.attachment.height}`}
      style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--dsh-border, #d4d4d8)', display: 'block' }}
    />
  )
}

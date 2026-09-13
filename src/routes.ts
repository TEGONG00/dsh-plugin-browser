import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { BrowserController, ElementPick } from './browser.ts'

const CMD_BODY_LIMIT = 1024 * 1024
const SSE_HEARTBEAT_MS = 15_000

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > CMD_BODY_LIMIT) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** Client → host commands for the browser panel. */
type PanelCommand =
  | { type: 'ensure' }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'input'; kind: 'move' | 'click' | 'dblclick'; x: number; y: number }
  | { type: 'input'; kind: 'wheel'; dx: number; dy: number }
  | { type: 'input'; kind: 'key'; key: string }
  | { type: 'input'; kind: 'type'; text: string }
  | { type: 'pick'; enabled: boolean }

export function registerRoutes(ctx: Context, browser: BrowserController): void {
  // Screencast + status + pick events to the panel (SSE, long-lived).
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-browser/api/stream',
    handler: async (req, res) => {
      if (!sameOrigin(req) || req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      })
      const send = (event: string, data: string) => {
        if (!res.writableEnded) res.write(`event: ${event}\ndata: ${data}\n\n`)
      }
      send('status', JSON.stringify(await browser.status()))
      const unsubs = [
        browser.onFrame((b64) => send('frame', b64)),
        browser.onStatus((s) => send('status', JSON.stringify(s))),
        browser.onPick((p: ElementPick) => send('pick', JSON.stringify(p))),
      ]
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': ping\n\n')
      }, SSE_HEARTBEAT_MS)
      req.on('close', () => {
        clearInterval(heartbeat)
        for (const unsub of unsubs) unsub()
        void browser.setSubscriberCount(-1)
      })
      await browser.setSubscriberCount(1)
    },
  })

  // Panel commands: navigation, input forwarding, pick-mode toggle.
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-browser/api/cmd',
    handler: async (req, res) => {
      if (req.method !== 'POST' || !sameOrigin(req)) {
        json(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      let command: PanelCommand
      try {
        command = JSON.parse(await readBody(req)) as PanelCommand
      } catch {
        json(res, 400, { ok: false, error: 'invalid json' })
        return
      }
      try {
        const status = await dispatchCommand(browser, command)
        json(res, 200, { ok: true, status })
      } catch (error) {
        json(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}

async function dispatchCommand(browser: BrowserController, command: PanelCommand): Promise<unknown> {
  switch (command.type) {
    case 'ensure':
      await browser.ensure()
      return await browser.status()
    case 'navigate':
      return await browser.goto(command.url)
    case 'back':
      await browser.goBack()
      return await browser.status()
    case 'forward':
      await browser.goForward()
      return await browser.status()
    case 'reload':
      await browser.reload()
      return await browser.status()
    case 'input': {
      if (command.kind === 'wheel') await browser.wheel(command.dx, command.dy)
      else if (command.kind === 'key') await browser.pressKey(command.key)
      else if (command.kind === 'type') await browser.typeText(command.text)
      else await browser.mouse(command.kind, command.x, command.y)
      return await browser.status()
    }
    case 'pick':
      await browser.setPickEnabled(command.enabled)
      return { pickEnabled: command.enabled }
  }
}

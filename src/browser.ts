import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { PICKER_SCRIPT } from './picker-script.ts'
import type { Config } from './config.ts'

/**
 * Chromium needs libnspr4/libnss3, which may be absent on minimal WSL setups
 * where the user cannot sudo. When this plugin ships a .chromium-deps tree
 * (debs unpacked via `dpkg -x`), inject it through LD_LIBRARY_PATH so the
 * browser process finds them without touching system state.
 */
const LOCAL_DEPS_DIR = fileURLToPath(new URL('../.chromium-deps/usr/lib/x86_64-linux-gnu/', import.meta.url))

function launchEnv(): Record<string, string> {
  if (!existsSync(LOCAL_DEPS_DIR)) return { ...process.env } as Record<string, string>
  const existing = process.env.LD_LIBRARY_PATH
  return {
    ...process.env,
    LD_LIBRARY_PATH: existing ? `${LOCAL_DEPS_DIR}:${existing}` : LOCAL_DEPS_DIR,
  } as Record<string, string>
}

export interface BrowserStatus {
  url: string
  title: string
  viewport: { width: number; height: number }
}

export interface ElementPick extends Record<string, unknown> {
  tag: string
  id: string
  classes: string
  role: string
  ariaLabel: string
  name: string
  placeholder: string
  href: string
  type: string
  text: string
  selector: string
  outerHTML: string
  rect: { x: number; y: number; width: number; height: number; docX: number; docY: number }
  scrollX: number
  scrollY: number
  viewport: { width: number; height: number }
  url: string
  title: string
}

type Listener<T> = (value: T) => void

const MAX_OUTLINE_ENTRIES = 200
const IDX_ATTR = 'data-dsh-browser-idx'

/** Owns the Playwright browser, screencast fan-out, input dispatch, and the pick pipeline. */
export class BrowserController {
  private readonly config: Config
  private browser?: Browser
  private context?: BrowserContext
  private page?: Page
  private cdp?: CDPSession
  private pickEnabled = false
  private screencastActive = false
  private subscriberCount = 0
  private starting?: Promise<void>
  private cdpFrameHandler?: (frame: { data?: string; sessionId?: string }) => void
  private readonly frameListeners = new Set<Listener<string>>()
  private readonly pickListeners = new Set<Listener<ElementPick>>()
  private readonly statusListeners = new Set<Listener<BrowserStatus>>()
  private readonly logger = console
  private lastWheelStatusPush = 0
  private wheelPushTimer?: ReturnType<typeof setTimeout>

  constructor(config: Config) {
    this.config = config
  }

  async dispose(): Promise<void> {
    try {
      await this.browser?.close()
    } catch (error) {
      this.logger.warn('[dsh-plugin-browser] browser close failed', error)
    }
    this.browser = undefined
    this.context = undefined
    this.page = undefined
    this.cdp = undefined
    this.screencastActive = false
  }

  onFrame(listener: Listener<string>): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onPick(listener: Listener<ElementPick>): () => void {
    this.pickListeners.add(listener)
    return () => this.pickListeners.delete(listener)
  }

  onStatus(listener: Listener<BrowserStatus>): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /** Idempotently launch (or attach) and prepare the page. Safe to call per request. */
  async ensure(): Promise<Page> {
    if (this.page && !this.page.isClosed() && this.browser?.isConnected()) return this.page
    if (this.starting) return this.starting.then(() => this.requirePage())
    this.starting = this.start().finally(() => {
      this.starting = undefined
    })
    await this.starting
    return this.requirePage()
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('browser page unavailable')
    return this.page
  }

  private async start(): Promise<void> {
    const viewport = {
      width: this.config.viewport?.width ?? 1280,
      height: this.config.viewport?.height ?? 800,
    }
    if (this.config.cdpEndpoint) {
      this.browser = await chromium.connectOverCDP(this.config.cdpEndpoint)
      this.context = this.browser.contexts()[0] ?? await this.browser.newContext({ viewport })
    } else {
      this.browser = await chromium.launch({
        headless: this.config.headless ?? true,
        executablePath: this.config.executablePath,
        env: launchEnv(),
      })
      this.context = await this.browser.newContext({ viewport })
    }
    this.page = await this.context.newPage()
    await this.page.setViewportSize(viewport)
    // One binding per context; it survives navigations.
    await this.page.exposeBinding('__dshBrowserPickReport', (_source, payload: unknown) => {
      void this.handlePick(payload as Record<string, unknown>)
    })
    this.page.on('framenavigated', (frame) => {
      if (frame !== this.page?.mainFrame()) return
      if (this.pickEnabled) void this.applyPicker(true)
      void this.pushStatus()
    })
    this.page.on('close', () => {
      this.page = undefined
      this.cdp = undefined
      this.screencastActive = false
    })
    this.logger.info('[dsh-plugin-browser] chromium ready')
  }

  private async handlePick(payload: Record<string, unknown>): Promise<void> {
    const page = this.page
    if (!page) return
    try {
      const pick = {
        ...(payload as unknown as ElementPick),
        url: page.url(),
        title: await page.title().catch(() => ''),
      }
      for (const listener of this.pickListeners) {
        try {
          listener(pick)
        } catch (error) {
          this.logger.warn('[dsh-plugin-browser] pick listener failed', error)
        }
      }
    } catch (error) {
      this.logger.warn('[dsh-plugin-browser] pick handling failed', error)
    }
  }

  async status(): Promise<BrowserStatus> {
    if (!this.page || !this.browser?.isConnected()) {
      return {
        url: '',
        title: '',
        viewport: {
          width: this.config.viewport?.width ?? 1280,
          height: this.config.viewport?.height ?? 800,
        },
      }
    }
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ''),
      viewport: this.page.viewportSize() ?? { width: 1280, height: 800 },
    }
  }

  async pushStatus(): Promise<void> {
    try {
      const current = await this.status()
      for (const listener of this.statusListeners) {
        try {
          listener(current)
        } catch (error) {
          this.logger.warn('[dsh-plugin-browser] status listener failed', error)
        }
      }
    } catch (error) {
      this.logger.warn('[dsh-plugin-browser] status push failed', error)
    }
  }

  /** Screencast runs only while at least one SSE subscriber watches the panel. */
  async setSubscriberCount(delta: number): Promise<void> {
    this.subscriberCount = Math.max(0, this.subscriberCount + delta)
    if (this.subscriberCount === 0) {
      await this.stopScreencast()
      return
    }
    try {
      await this.ensure()
      if (this.screencastActive) return
      await this.startScreencast()
    } catch (error) {
      // Never escape: a dead page/session must downgrade to "no frames"
      // (retry on the next subscriber), not take the host down.
      this.logger.warn('[dsh-plugin-browser] screencast unavailable; will retry on next subscribe', error)
      this.cdp = undefined
      this.screencastActive = false
    }
  }

  private async startScreencast(): Promise<void> {
    const page = this.requirePage()
    // A CDP target can transiently detach (resize/navigation racing the
    // attach in headless shells) — retry on a FRESH session before giving
    // up; the caller downgrades to "no frames" after the last attempt.
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.attachScreencastSession(page)
        this.screencastActive = true
        return
      } catch (error) {
        lastError = error
        this.cdp = undefined
        this.cdpFrameHandler = undefined
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    throw lastError
  }

  private async attachScreencastSession(page: Page): Promise<void> {
    // Always attach a fresh CDP session: a cached one goes stale whenever the
    // page was replaced by navigation or a crash ("Not attached to an active
    // page"), and reusing it turns the next start into a throw.
    if (this.cdp) {
      const stale = this.cdp
      this.cdp = undefined
      this.cdpFrameHandler = undefined
      try {
        await stale.send('Page.stopScreencast').catch(() => undefined)
        await stale.detach().catch(() => undefined)
      } catch {
        // detach of an already-dead session is fine
      }
    }
    const session = await page.context().newCDPSession(page)
    this.cdp = session
    const onFrame = (frame: { data?: string; sessionId?: string }) => {
      if (frame.data) {
        for (const listener of this.frameListeners) {
          try {
            listener(frame.data)
          } catch (error) {
            this.logger.warn('[dsh-plugin-browser] frame listener failed', error)
          }
        }
      }
      if (frame.sessionId) {
        const frameSessionId = frame.sessionId
        void session.send('Page.screencastFrameAck', {
          sessionId: frameSessionId as unknown as number,
        }).catch(() => undefined)
      }
    }
    session.on('Page.screencastFrame', onFrame as never)
    this.cdpFrameHandler = onFrame
    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: this.config.jpegQuality ?? 60,
      maxWidth: 1600,
      maxHeight: 1200,
      everyNthFrame: 1,
    })
  }

  private async stopScreencast(): Promise<void> {
    if (!this.screencastActive) return
    try {
      if (this.cdp) {
        if (this.cdpFrameHandler) {
          this.cdp.removeListener('Page.screencastFrame', this.cdpFrameHandler as never)
          this.cdpFrameHandler = undefined
        }
        await this.cdp.send('Page.stopScreencast').catch(() => undefined)
      }
    } finally {
      this.screencastActive = false
    }
  }

  async setPickEnabled(enabled: boolean): Promise<void> {
    this.pickEnabled = enabled
    await this.applyPicker(enabled)
  }

  private async applyPicker(enabled: boolean): Promise<void> {
    const page = this.page
    if (!page || !this.browser?.isConnected()) return
    try {
      if (enabled) {
        await page.evaluate(PICKER_SCRIPT)
      } else {
        await page.evaluate(`window.__dshBrowserPicker && window.__dshBrowserPicker.setEnabled(false)`)
      }
    } catch (error) {
      this.logger.warn('[dsh-plugin-browser] picker injection failed', error)
    }
  }

  async goto(url: string): Promise<BrowserStatus> {
    const page = await this.ensure()
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      url = `https://${url}`
    }
    await page.goto(url, { waitUntil: 'load', timeout: this.config.navigationTimeoutMs ?? 30_000 })
    if (this.pickEnabled) await this.applyPicker(true)
    const current = await this.status()
    await this.pushStatus()
    return current
  }

  async goBack(): Promise<void> {
    const page = await this.ensure()
    await page.goBack({ timeout: this.config.navigationTimeoutMs ?? 30_000 }).catch(() => undefined)
    if (this.pickEnabled) await this.applyPicker(true)
    await this.pushStatus()
  }

  async goForward(): Promise<void> {
    const page = await this.ensure()
    await page.goForward({ timeout: this.config.navigationTimeoutMs ?? 30_000 }).catch(() => undefined)
    if (this.pickEnabled) await this.applyPicker(true)
    await this.pushStatus()
  }

  async reload(): Promise<void> {
    const page = await this.ensure()
    await page.reload({ timeout: this.config.navigationTimeoutMs ?? 30_000 })
    if (this.pickEnabled) await this.applyPicker(true)
    await this.pushStatus()
  }

  /** Match the controlled viewport to the panel's box so the page fills it. */
  async resize(width: number, height: number): Promise<void> {
    const page = await this.ensure()
    const w = Math.round(Math.min(2000, Math.max(240, width)))
    const h = Math.round(Math.min(2400, Math.max(200, height)))
    const current = page.viewportSize()
    if (current && Math.abs(current.width - w) < 2 && Math.abs(current.height - h) < 2) return
    await page.setViewportSize({ width: w, height: h })
    await this.pushStatus()
  }

  async mouse(kind: 'move' | 'click' | 'dblclick', x: number, y: number): Promise<void> {
    const page = await this.ensure()
    if (kind === 'move') await page.mouse.move(x, y)
    else if (kind === 'dblclick') await page.mouse.dblclick(x, y)
    else await page.mouse.click(x, y, { delay: 30 })
  }

  /** Wheel at an explicit page position: the virtual cursor may be stale or
   * sitting outside an inner scrollable, so move first, then scroll. Status
   * pushes are throttled — trackpad streams fire many events per second. */
  async wheel(x: number, y: number, dx: number, dy: number): Promise<void> {
    const page = await this.ensure()
    await page.mouse.move(x, y)
    await page.mouse.wheel(dx, dy)
    // Trailing-edge throttled status push: never lose the FINAL state to the
    // throttle window (scroll position/title changes ride these updates).
    if (this.wheelPushTimer) return
    const elapsed = Date.now() - this.lastWheelStatusPush
    if (elapsed > 600) {
      this.lastWheelStatusPush = Date.now()
      void this.pushStatus()
      return
    }
    this.wheelPushTimer = setTimeout(() => {
      this.wheelPushTimer = undefined
      this.lastWheelStatusPush = Date.now()
      void this.pushStatus()
    }, 700 - elapsed)
  }

  async pressKey(key: string): Promise<void> {
    const page = await this.ensure()
    await page.keyboard.press(key)
  }

  async typeText(text: string): Promise<void> {
    const page = await this.ensure()
    await page.keyboard.type(text)
  }

  /**
   * Annotate visible interactive elements with sequential indices and return a
   * text outline. The model clicks/types by index via the attribute selector.
   */
  async snapshotOutline(): Promise<{ url: string; title: string; count: number; outline: string }> {
    const page = await this.ensure()
    const outline = await page.evaluate(({ attr, max }) => {
      document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr))
      const selector = 'a, button, input, textarea, select, [role], [onclick], [contenteditable], label, summary, h1, h2, h3, h4, h5, h6'
      const lines: string[] = []
      let index = 0
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (index >= max) break
        const style = window.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        const rect = el.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) continue
        index += 1
        el.setAttribute(attr, String(index))
        const tag = el.tagName.toLowerCase()
        const role = el.getAttribute('role') || ''
        const text = ((el as HTMLElement).innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('value') || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120)
        const label = [
          `<${tag}${role ? ` role=${role}` : ''}>`,
          text ? JSON.stringify(text) : '',
        ].filter(Boolean).join(' ')
        lines.push(`[${index}] ${label}`)
      }
      return { lines, count: index }
    }, { attr: IDX_ATTR, max: MAX_OUTLINE_ENTRIES })
    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      count: outline.count,
      outline: outline.lines.join('\n'),
    }
  }

  async clickByIndex(idx: number): Promise<BrowserStatus> {
    const page = await this.ensure()
    await page.locator(`[${IDX_ATTR}="${idx}"]`).first().click({ timeout: 5000 })
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => undefined)
    if (this.pickEnabled) await this.applyPicker(true)
    const current = await this.status()
    await this.pushStatus()
    return current
  }

  async typeByIndex(idx: number, text: string, submit?: boolean): Promise<BrowserStatus> {
    const page = await this.ensure()
    const locator = page.locator(`[${IDX_ATTR}="${idx}"]`).first()
    await locator.fill(text, { timeout: 5000 })
    if (submit) await locator.press('Enter', { timeout: 5000 })
    const current = await this.status()
    await this.pushStatus()
    return current
  }

  async screenshot(): Promise<{ base64: string; width: number; height: number }> {
    const page = await this.ensure()
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: this.config.jpegQuality ?? 60,
      fullPage: false,
    })
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 }
    return { base64: buffer.toString('base64'), width: viewport.width, height: viewport.height }
  }
}

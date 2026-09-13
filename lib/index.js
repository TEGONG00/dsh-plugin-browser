// src/browser.ts
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// src/picker-script.ts
var PICKER_SCRIPT = `
(() => {
  if (window.__dshBrowserPicker) {
    window.__dshBrowserPicker.setEnabled(true)
    return
  }

  const overlay = document.createElement('div')
  overlay.setAttribute('data-dsh-browser-picker-overlay', '')
  overlay.style.cssText = [
    'position: fixed', 'z-index: 2147483646', 'pointer-events: none',
    'display: none', 'box-sizing: border-box',
    'outline: 2px solid #4f8ef7', 'outline-offset: -2px',
    'background: rgba(79, 142, 247, 0.12)',
  ].join(';')
  const label = document.createElement('div')
  label.style.cssText = [
    'position: fixed', 'z-index: 2147483647', 'pointer-events: none', 'display: none',
    'font: 11px/1.4 monospace', 'padding: 2px 6px', 'border-radius: 3px',
    'background: #1f2937', 'color: #e5e7eb', 'white-space: nowrap', 'max-width: 420px',
    'overflow: hidden', 'text-overflow: ellipsis',
  ].join(';')
  const mount = () => {
    if (!overlay.isConnected) {
      ;(document.body || document.documentElement).appendChild(overlay)
      ;(document.body || document.documentElement).appendChild(label)
    }
  }

  const swallow = (e) => {
    if (!state.enabled) return
    e.preventDefault()
    e.stopPropagation()
  }

  const onMove = (e) => {
    if (!state.enabled) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || el === overlay || el === label || el.closest('[data-dsh-browser-picker-overlay]')) return
    mount()
    const r = el.getBoundingClientRect()
    overlay.style.display = 'block'
    overlay.style.left = r.x + 'px'
    overlay.style.top = r.y + 'px'
    overlay.style.width = r.width + 'px'
    overlay.style.height = r.height + 'px'
    label.style.display = 'block'
    label.textContent = describeLabel(el)
    label.style.left = Math.min(e.clientX + 12, window.innerWidth - 8) + 'px'
    label.style.top = Math.min(e.clientY + 14, window.innerHeight - 24) + 'px'
  }

  const onLeave = () => {
    overlay.style.display = 'none'
    label.style.display = 'none'
  }

  const onClick = (e) => {
    if (!state.enabled) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el) return
    try {
      window.__dshBrowserPickReport(describe(el))
    } catch (err) {
      console.warn('[dsh-browser] pick report failed', err)
    }
  }

  const state = { enabled: false }

  function describeLabel(el) {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? '#' + el.id : ''
    const cls = el.classList && el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''
    return tag + id + cls
  }

  function cssPath(el) {
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let sel = node.tagName.toLowerCase()
      if (node.id) {
        sel = '#' + CSS.escape(node.id)
        parts.unshift(sel)
        break
      }
      const parent = node.parentElement
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName)
        if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'
      }
      parts.unshift(sel)
      node = parent
    }
    return parts.join(' > ')
  }

  function describe(el) {
    const r = el.getBoundingClientRect()
    const outer = el.outerHTML || ''
    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300)
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: el.getAttribute('class') || '',
      role: el.getAttribute('role') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      href: el.getAttribute('href') || '',
      type: el.getAttribute('type') || '',
      text,
      selector: cssPath(el),
      outerHTML: outer.length > 4000 ? outer.slice(0, 4000) + '\u2026' : outer,
      rect: {
        x: r.x, y: r.y, width: r.width, height: r.height,
        docX: r.x + window.scrollX, docY: r.y + window.scrollY,
      },
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  }

  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('mousedown', swallow, true)
  window.addEventListener('mouseup', swallow, true)
  window.addEventListener('click', onClick, true)
  document.addEventListener('mouseleave', onLeave, true)

  window.__dshBrowserPicker = {
    setEnabled(v) {
      state.enabled = v
      if (!v) onLeave()
    },
  }
  window.__dshBrowserPicker.setEnabled(true)
})()
`;

// src/browser.ts
var LOCAL_DEPS_DIR = fileURLToPath(new URL("../.chromium-deps/usr/lib/x86_64-linux-gnu/", import.meta.url));
function launchEnv() {
  if (!existsSync(LOCAL_DEPS_DIR)) return { ...process.env };
  const existing = process.env.LD_LIBRARY_PATH;
  return {
    ...process.env,
    LD_LIBRARY_PATH: existing ? `${LOCAL_DEPS_DIR}:${existing}` : LOCAL_DEPS_DIR
  };
}
var MAX_OUTLINE_ENTRIES = 200;
var IDX_ATTR = "data-dsh-browser-idx";
var BrowserController = class {
  config;
  browser;
  context;
  page;
  cdp;
  pickEnabled = false;
  screencastActive = false;
  subscriberCount = 0;
  starting;
  cdpFrameHandler;
  frameListeners = /* @__PURE__ */ new Set();
  pickListeners = /* @__PURE__ */ new Set();
  statusListeners = /* @__PURE__ */ new Set();
  logger = console;
  lastWheelStatusPush = 0;
  wheelPushTimer;
  constructor(config) {
    this.config = config;
  }
  async dispose() {
    try {
      await this.browser?.close();
    } catch (error) {
      this.logger.warn("[dsh-plugin-browser] browser close failed", error);
    }
    this.browser = void 0;
    this.context = void 0;
    this.page = void 0;
    this.cdp = void 0;
    this.screencastActive = false;
  }
  onFrame(listener) {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }
  onPick(listener) {
    this.pickListeners.add(listener);
    return () => this.pickListeners.delete(listener);
  }
  onStatus(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
  /** Idempotently launch (or attach) and prepare the page. Safe to call per request. */
  async ensure() {
    if (this.page && !this.page.isClosed() && this.browser?.isConnected()) return this.page;
    if (this.starting) return this.starting.then(() => this.requirePage());
    this.starting = this.start().finally(() => {
      this.starting = void 0;
    });
    await this.starting;
    return this.requirePage();
  }
  requirePage() {
    if (!this.page) throw new Error("browser page unavailable");
    return this.page;
  }
  async start() {
    const viewport = {
      width: this.config.viewport?.width ?? 1280,
      height: this.config.viewport?.height ?? 800
    };
    if (this.config.cdpEndpoint) {
      this.browser = await chromium.connectOverCDP(this.config.cdpEndpoint);
      this.context = this.browser.contexts()[0] ?? await this.browser.newContext({ viewport });
    } else {
      this.browser = await chromium.launch({
        headless: this.config.headless ?? true,
        executablePath: this.config.executablePath,
        env: launchEnv()
      });
      this.context = await this.browser.newContext({ viewport });
    }
    this.page = await this.context.newPage();
    await this.page.setViewportSize(viewport);
    await this.page.exposeBinding("__dshBrowserPickReport", (_source, payload) => {
      void this.handlePick(payload);
    });
    this.page.on("framenavigated", (frame) => {
      if (frame !== this.page?.mainFrame()) return;
      if (this.pickEnabled) void this.applyPicker(true);
      void this.pushStatus();
    });
    this.page.on("close", () => {
      this.page = void 0;
      this.cdp = void 0;
      this.screencastActive = false;
    });
    this.logger.info("[dsh-plugin-browser] chromium ready");
  }
  async handlePick(payload) {
    const page = this.page;
    if (!page) return;
    try {
      const pick = {
        ...payload,
        url: page.url(),
        title: await page.title().catch(() => "")
      };
      for (const listener of this.pickListeners) {
        try {
          listener(pick);
        } catch (error) {
          this.logger.warn("[dsh-plugin-browser] pick listener failed", error);
        }
      }
    } catch (error) {
      this.logger.warn("[dsh-plugin-browser] pick handling failed", error);
    }
  }
  async status() {
    if (!this.page || !this.browser?.isConnected()) {
      return {
        url: "",
        title: "",
        viewport: {
          width: this.config.viewport?.width ?? 1280,
          height: this.config.viewport?.height ?? 800
        }
      };
    }
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ""),
      viewport: this.page.viewportSize() ?? { width: 1280, height: 800 }
    };
  }
  async pushStatus() {
    try {
      const current = await this.status();
      for (const listener of this.statusListeners) {
        try {
          listener(current);
        } catch (error) {
          this.logger.warn("[dsh-plugin-browser] status listener failed", error);
        }
      }
    } catch (error) {
      this.logger.warn("[dsh-plugin-browser] status push failed", error);
    }
  }
  /** Screencast runs only while at least one SSE subscriber watches the panel. */
  async setSubscriberCount(delta) {
    this.subscriberCount = Math.max(0, this.subscriberCount + delta);
    if (this.subscriberCount === 0) {
      await this.stopScreencast();
      return;
    }
    try {
      await this.ensure();
      if (this.screencastActive) return;
      await this.startScreencast();
    } catch (error) {
      this.logger.warn("[dsh-plugin-browser] screencast unavailable; will retry on next subscribe", error);
      this.cdp = void 0;
      this.screencastActive = false;
    }
  }
  async startScreencast() {
    const page = this.requirePage();
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.attachScreencastSession(page);
        this.screencastActive = true;
        return;
      } catch (error) {
        lastError = error;
        this.cdp = void 0;
        this.cdpFrameHandler = void 0;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw lastError;
  }
  async attachScreencastSession(page) {
    if (this.cdp) {
      const stale = this.cdp;
      this.cdp = void 0;
      this.cdpFrameHandler = void 0;
      try {
        await stale.send("Page.stopScreencast").catch(() => void 0);
        await stale.detach().catch(() => void 0);
      } catch {
      }
    }
    const session = await page.context().newCDPSession(page);
    this.cdp = session;
    const onFrame = (frame) => {
      if (frame.data) {
        for (const listener of this.frameListeners) {
          try {
            listener(frame.data);
          } catch (error) {
            this.logger.warn("[dsh-plugin-browser] frame listener failed", error);
          }
        }
      }
      if (frame.sessionId) {
        const frameSessionId = frame.sessionId;
        void session.send("Page.screencastFrameAck", {
          sessionId: frameSessionId
        }).catch(() => void 0);
      }
    };
    session.on("Page.screencastFrame", onFrame);
    this.cdpFrameHandler = onFrame;
    await session.send("Page.startScreencast", {
      format: "jpeg",
      quality: this.config.jpegQuality ?? 60,
      maxWidth: 1600,
      maxHeight: 1200,
      everyNthFrame: 1
    });
  }
  async stopScreencast() {
    if (!this.screencastActive) return;
    try {
      if (this.cdp) {
        if (this.cdpFrameHandler) {
          this.cdp.removeListener("Page.screencastFrame", this.cdpFrameHandler);
          this.cdpFrameHandler = void 0;
        }
        await this.cdp.send("Page.stopScreencast").catch(() => void 0);
      }
    } finally {
      this.screencastActive = false;
    }
  }
  async setPickEnabled(enabled) {
    this.pickEnabled = enabled;
    await this.applyPicker(enabled);
  }
  async applyPicker(enabled) {
    const page = this.page;
    if (!page || !this.browser?.isConnected()) return;
    try {
      if (enabled) {
        await page.evaluate(PICKER_SCRIPT);
      } else {
        await page.evaluate(`window.__dshBrowserPicker && window.__dshBrowserPicker.setEnabled(false)`);
      }
    } catch (error) {
      this.logger.warn("[dsh-plugin-browser] picker injection failed", error);
    }
  }
  async goto(url) {
    const page = await this.ensure();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      url = `https://${url}`;
    }
    await page.goto(url, { waitUntil: "load", timeout: this.config.navigationTimeoutMs ?? 3e4 });
    if (this.pickEnabled) await this.applyPicker(true);
    const current = await this.status();
    await this.pushStatus();
    return current;
  }
  async goBack() {
    const page = await this.ensure();
    await page.goBack({ timeout: this.config.navigationTimeoutMs ?? 3e4 }).catch(() => void 0);
    if (this.pickEnabled) await this.applyPicker(true);
    await this.pushStatus();
  }
  async goForward() {
    const page = await this.ensure();
    await page.goForward({ timeout: this.config.navigationTimeoutMs ?? 3e4 }).catch(() => void 0);
    if (this.pickEnabled) await this.applyPicker(true);
    await this.pushStatus();
  }
  async reload() {
    const page = await this.ensure();
    await page.reload({ timeout: this.config.navigationTimeoutMs ?? 3e4 });
    if (this.pickEnabled) await this.applyPicker(true);
    await this.pushStatus();
  }
  /** Match the controlled viewport to the panel's box so the page fills it. */
  async resize(width, height) {
    const page = await this.ensure();
    const w = Math.round(Math.min(2e3, Math.max(240, width)));
    const h = Math.round(Math.min(2400, Math.max(200, height)));
    const current = page.viewportSize();
    if (current && Math.abs(current.width - w) < 2 && Math.abs(current.height - h) < 2) return;
    await page.setViewportSize({ width: w, height: h });
    await this.pushStatus();
  }
  async mouse(kind, x, y) {
    const page = await this.ensure();
    if (kind === "move") await page.mouse.move(x, y);
    else if (kind === "dblclick") await page.mouse.dblclick(x, y);
    else await page.mouse.click(x, y, { delay: 30 });
  }
  /** Wheel at an explicit page position: the virtual cursor may be stale or
   * sitting outside an inner scrollable, so move first, then scroll. Status
   * pushes are throttled — trackpad streams fire many events per second. */
  async wheel(x, y, dx, dy) {
    const page = await this.ensure();
    await page.mouse.move(x, y);
    await page.mouse.wheel(dx, dy);
    if (this.wheelPushTimer) return;
    const elapsed = Date.now() - this.lastWheelStatusPush;
    if (elapsed > 600) {
      this.lastWheelStatusPush = Date.now();
      void this.pushStatus();
      return;
    }
    this.wheelPushTimer = setTimeout(() => {
      this.wheelPushTimer = void 0;
      this.lastWheelStatusPush = Date.now();
      void this.pushStatus();
    }, 700 - elapsed);
  }
  async pressKey(key) {
    const page = await this.ensure();
    await page.keyboard.press(key);
  }
  async typeText(text) {
    const page = await this.ensure();
    await page.keyboard.type(text);
  }
  /**
   * Annotate visible interactive elements with sequential indices and return a
   * text outline. The model clicks/types by index via the attribute selector.
   */
  async snapshotOutline() {
    const page = await this.ensure();
    const outline = await page.evaluate(({ attr, max }) => {
      document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
      const selector = "a, button, input, textarea, select, [role], [onclick], [contenteditable], label, summary, h1, h2, h3, h4, h5, h6";
      const lines = [];
      let index = 0;
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (index >= max) break;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        index += 1;
        el.setAttribute(attr, String(index));
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || "";
        const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("value") || "").replace(/\s+/g, " ").trim().slice(0, 120);
        const label = [
          `<${tag}${role ? ` role=${role}` : ""}>`,
          text ? JSON.stringify(text) : ""
        ].filter(Boolean).join(" ");
        lines.push(`[${index}] ${label}`);
      }
      return { lines, count: index };
    }, { attr: IDX_ATTR, max: MAX_OUTLINE_ENTRIES });
    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      count: outline.count,
      outline: outline.lines.join("\n")
    };
  }
  async clickByIndex(idx) {
    const page = await this.ensure();
    await page.locator(`[${IDX_ATTR}="${idx}"]`).first().click({ timeout: 5e3 });
    await page.waitForLoadState("load", { timeout: 5e3 }).catch(() => void 0);
    if (this.pickEnabled) await this.applyPicker(true);
    const current = await this.status();
    await this.pushStatus();
    return current;
  }
  async typeByIndex(idx, text, submit) {
    const page = await this.ensure();
    const locator = page.locator(`[${IDX_ATTR}="${idx}"]`).first();
    await locator.fill(text, { timeout: 5e3 });
    if (submit) await locator.press("Enter", { timeout: 5e3 });
    const current = await this.status();
    await this.pushStatus();
    return current;
  }
  async screenshot() {
    const page = await this.ensure();
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: this.config.jpegQuality ?? 60,
      fullPage: false
    });
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    return { base64: buffer.toString("base64"), width: viewport.width, height: viewport.height };
  }
};

// src/config.ts
import Schema from "@deepseek-ai/schemastery";
var Config = Schema.object({
  headless: Schema.boolean().default(true).description("Run Chromium headless"),
  viewport: Schema.object({
    width: Schema.number().default(1280),
    height: Schema.number().default(800)
  }).description("Controlled page viewport"),
  cdpEndpoint: Schema.string().description("Connect to a running browser over CDP instead of launching"),
  executablePath: Schema.string().description("Custom Chromium executable"),
  jpegQuality: Schema.number().default(60).min(1).max(100),
  navigationTimeoutMs: Schema.number().default(3e4)
});

// src/tools.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
function baseProperties() {
  return {};
}
function registerTools(ctx, browser) {
  ctx.tools.register(defineTool({
    name: "browser_navigate",
    description: [
      "Open a URL in the built-in browser panel (visible to the user in the dsh web client).",
      "Use it to open the page you are working on so the user can point at elements, and to verify visual changes you made to code."
    ].join(" "),
    parameters: {
      url: { type: "string", required: true, description: "Absolute URL (https://\u2026 or http://localhost:\u2026)" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", required: true },
          title: { type: "string", required: true }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: `Navigated to ${value.url}${value.title ? ` \u2014 "${value.title}"` : ""}`
      }]
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      const status = await browser.goto(args.url);
      return { url: status.url, title: status.title };
    }
  }));
  ctx.tools.register(defineTool({
    name: "browser_screenshot",
    description: [
      "Take a JPEG screenshot of the built-in browser panel viewport.",
      "Returns a visible image so you can inspect the page the user is looking at, and verify your code changes rendered correctly."
    ].join(" "),
    parameters: baseProperties(),
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", required: true },
          title: { type: "string", required: true },
          image: {
            type: "object",
            required: true,
            additionalProperties: false,
            properties: {
              attachmentId: { type: "string", required: true },
              mediaType: { type: "string", required: true },
              width: { type: "integer", required: true },
              height: { type: "integer", required: true },
              bytes: { type: "integer", required: true }
            }
          }
        }
      },
      render: (_args, value) => [
        {
          type: "text",
          text: `Screenshot of ${value.url}${value.title ? ` \u2014 "${value.title}"` : ""} (${value.image.width}\xD7${value.image.height}), attached above.`
        },
        {
          type: "image",
          attachment: {
            attachmentId: value.image.attachmentId,
            mediaType: value.image.mediaType,
            bytes: value.image.bytes,
            width: value.image.width,
            height: value.image.height
          }
        }
      ],
      presentationMeta: (_args, value) => ({
        card: "browser-screenshot",
        url: value.url,
        title: value.title,
        width: value.image.width,
        height: value.image.height,
        attachmentId: value.image.attachmentId
      })
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      const page = await browser.ensure();
      const shot = await browser.screenshot();
      const ref = await ctx.attachments.saveImage({
        data: Buffer.from(shot.base64, "base64"),
        mediaType: "image/jpeg",
        name: `browser-screenshot-${Date.now()}.jpg`
      });
      return {
        url: page.url(),
        title: await page.title().catch(() => ""),
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          width: ref.width,
          height: ref.height,
          bytes: ref.bytes
        }
      };
    }
  }));
  ctx.tools.register(defineTool({
    name: "browser_snapshot",
    description: [
      "List the interactive elements currently visible in the built-in browser page.",
      "Each line starts with an index like [12]; pass that index to browser_click or browser_type.",
      "Run this again after navigation \u2014 indices change."
    ].join(" "),
    parameters: baseProperties(),
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", required: true },
          title: { type: "string", required: true },
          count: { type: "integer", required: true },
          outline: { type: "string", required: true }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: `Page ${value.url} (${value.title || "untitled"}) \u2014 ${value.count} interactive elements:
${value.outline}`
      }]
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      return await browser.snapshotOutline();
    }
  }));
  ctx.tools.register(defineTool({
    name: "browser_click",
    description: "Click an element in the built-in browser by its index from the latest browser_snapshot.",
    parameters: {
      idx: { type: "integer", required: true, description: "Element index from browser_snapshot, e.g. 12 for [12]" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", required: true },
          title: { type: "string", required: true }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: `Clicked. Now on ${value.url}${value.title ? ` \u2014 "${value.title}"` : ""}`
      }]
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      const status = await browser.clickByIndex(args.idx);
      return { url: status.url, title: status.title };
    }
  }));
  ctx.tools.register(defineTool({
    name: "browser_type",
    description: "Replace the text of an input element in the built-in browser and optionally press Enter.",
    parameters: {
      idx: { type: "integer", required: true, description: "Element index from browser_snapshot" },
      text: { type: "string", required: true, description: "Text to fill into the field" },
      submit: { type: "boolean", description: "Press Enter after filling (default false)" }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", required: true },
          title: { type: "string", required: true }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: `Typed into element. Now on ${value.url}${value.title ? ` \u2014 "${value.title}"` : ""}`
      }]
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted();
      const status = await browser.typeByIndex(args.idx, args.text, args.submit);
      return { url: status.url, title: status.title };
    }
  }));
}

// src/routes.ts
var CMD_BODY_LIMIT = 1024 * 1024;
var SSE_HEARTBEAT_MS = 15e3;
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > CMD_BODY_LIMIT) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
function registerRoutes(ctx, browser) {
  ctx.webServer.register({
    kind: "exact",
    path: "/dsh-browser/api/stream",
    handler: async (req, res) => {
      if (!sameOrigin(req) || req.method !== "GET" && req.method !== "HEAD") {
        json(res, 403, { ok: false, error: "forbidden" });
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive"
      });
      const send = (event, data) => {
        if (!res.writableEnded) res.write(`event: ${event}
data: ${data}

`);
      };
      send("status", JSON.stringify(await browser.status()));
      const unsubs = [
        browser.onFrame((b64) => send("frame", b64)),
        browser.onStatus((s) => send("status", JSON.stringify(s))),
        browser.onPick((p) => send("pick", JSON.stringify(p)))
      ];
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(": ping\n\n");
      }, SSE_HEARTBEAT_MS);
      req.on("close", () => {
        clearInterval(heartbeat);
        for (const unsub of unsubs) unsub();
        void browser.setSubscriberCount(-1);
      });
      await browser.setSubscriberCount(1);
    }
  });
  ctx.webServer.register({
    kind: "exact",
    path: "/dsh-browser/api/cmd",
    handler: async (req, res) => {
      if (req.method !== "POST" || !sameOrigin(req)) {
        json(res, 403, { ok: false, error: "forbidden" });
        return;
      }
      let command;
      try {
        command = JSON.parse(await readBody(req));
      } catch {
        json(res, 400, { ok: false, error: "invalid json" });
        return;
      }
      try {
        const status = await dispatchCommand(browser, command);
        json(res, 200, { ok: true, status });
      } catch (error) {
        json(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  });
}
async function dispatchCommand(browser, command) {
  switch (command.type) {
    case "ensure":
      await browser.ensure();
      return await browser.status();
    case "navigate":
      return await browser.goto(command.url);
    case "back":
      await browser.goBack();
      return await browser.status();
    case "forward":
      await browser.goForward();
      return await browser.status();
    case "reload":
      await browser.reload();
      return await browser.status();
    case "resize":
      await browser.resize(command.width, command.height);
      return await browser.status();
    case "input": {
      if (command.kind === "wheel") await browser.wheel(command.x, command.y, command.dx, command.dy);
      else if (command.kind === "key") await browser.pressKey(command.key);
      else if (command.kind === "type") await browser.typeText(command.text);
      else await browser.mouse(command.kind, command.x, command.y);
      return await browser.status();
    }
    case "pick":
      await browser.setPickEnabled(command.enabled);
      return { pickEnabled: command.enabled };
  }
}

// src/index.ts
var name = "dsh-plugin-browser";
var inject = ["tools", "attachments"];
function apply(ctx, config) {
  const browser = new BrowserController(config);
  ctx.effect(() => {
    const closing = browser.dispose();
    return () => closing;
  }, "dsh-plugin-browser: chromium lifecycle");
  registerTools(ctx, browser);
  ctx.inject(["webServer"], (webCtx) => registerRoutes(webCtx, browser));
}
export {
  Config,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map

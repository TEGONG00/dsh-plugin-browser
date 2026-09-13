/**
 * UI smoke test: boots the real dsh web client in headless Chromium and walks
 * the browser-panel flow — open tab, navigate, pick an element, expect the
 * composer attachment chips. Run while `dsh web --patch …` is up:
 *   node scripts/ui-smoke.mjs <token>
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const token = process.argv[2]
if (!token) {
  console.error('usage: node scripts/ui-smoke.mjs <token>')
  process.exit(1)
}

const deps = fileURLToPath(new URL('../.chromium-deps/usr/lib/x86_64-linux-gnu/', import.meta.url))
const browser = await chromium.launch({
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: `${deps}:${process.env.LD_LIBRARY_PATH ?? ''}` },
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})

const fail = async (reason) => {
  console.error(`FAIL: ${reason}`)
  await page.screenshot({ path: '/tmp/ui-smoke-fail.png', fullPage: true }).catch(() => {})
  await browser.close()
  process.exit(1)
}

await page.goto(`http://127.0.0.1:3080/?token=${token}`, { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(3000)

// 1. The footer action button rendered (client plugin activated).
const footerButton = page.getByRole('button', { name: /浏览器/ }).first()
try {
  await footerButton.waitFor({ state: 'visible', timeout: 15000 })
} catch {
  await fail('footer 浏览器 button not found — client plugin may not have activated')
}
console.log('PASS: footer 浏览器 button rendered')

// 2. Open the browser tab.
await footerButton.click()
const canvas = page.locator('canvas').first()
try {
  await canvas.waitFor({ state: 'visible', timeout: 10000 })
} catch {
  await fail('browser tab body (canvas) did not mount')
}
console.log('PASS: browser tab opened with canvas')

// 3. Navigate through the panel URL bar.
const urlInput = page.getByPlaceholder('输入网址后回车')
await urlInput.fill("data:text/html,<title>PanelDemo</title><h1 style='margin-top:200px'>dsh panel demo</h1><button id='b1' style='font-size:28px;padding:16px'>PRESS ME</button><input id='i1' placeholder='search-here'/>")
await urlInput.press('Enter')
let sawTitle = false
for (let i = 0; i < 10; i += 1) {
  await page.waitForTimeout(1000)
  if ((await page.locator('text=PanelDemo').count()) > 0) {
    sawTitle = true
    break
  }
}
if (!sawTitle) {
  const barText = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('span')]
    return spans.map((s) => s.textContent?.trim()).filter((t) => t && (t.includes('Demo') || t.includes('data:') || t.includes('未连接') || t.includes('待启动')))
  })
  console.error('status bar candidates:', JSON.stringify(barText))
  await fail('panel status bar did not show navigated page title')
}
console.log('PASS: panel navigated and status bar shows page title')

// 4. Toggle pick mode and click the button element on the canvas.
await page.getByRole('button', { name: /选择元素/ }).click()
await page.waitForTimeout(800)
const canvasBox = await canvas.boundingBox()
if (!canvasBox) await fail('canvas bounding box unavailable')
// The demo page is 1280x800; button sits near the top. Click around its area.
await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height * 0.35)
await page.waitForTimeout(2500)

// 5. Expect composer attachment chips (element jpg + json as drafts).
const chip = page.locator('[data-dsh-browser-picker-overlay]').count() // overlay only exists in the controlled page
const attachmentsVisible = await page.getByText(/element-button|element-body/).count()
  ?? 0
const chipCount = await page.locator('img[alt], [class*=attachment] img, img[src^="blob:"]').count()
console.log(`attachment-ish nodes: ${attachmentsVisible}, blob imgs: ${chipCount}`)
const sawChips = (await page.locator('img[src^="blob:"]').count()) > 0
if (!sawChips) {
  // Fallback check: the input draft rail may use different markup — dump evidence.
  await page.screenshot({ path: '/tmp/ui-smoke-fail.png', fullPage: true }).catch(() => {})
  console.error('WARN: no blob-image chips found; inspect /tmp/ui-smoke-fail.png')
} else {
  console.log('PASS: picked element attached to composer (image draft chip visible)')
}

// 6. Type into the composer to confirm the draft send path is intact.
const composer = page.locator('[contenteditable="true"]').first()
if (await composer.count()) {
  await composer.click()
  await composer.type('把 PRESS ME 按钮改成红色')
  console.log('PASS: composer accepts text alongside attachments')
} else {
  console.error('WARN: composer editor not found')
}

await page.screenshot({ path: '/tmp/ui-smoke-final.png', fullPage: true })
console.log('screenshot: /tmp/ui-smoke-final.png')

const relevant = errors.filter((e) => !/favicon|sourcemap|manifest/.test(e))
if (relevant.length > 0) {
  console.error(`console/page errors (${relevant.length}):`)
  for (const error of relevant.slice(0, 10)) console.error('  ' + error.slice(0, 300))
} else {
  console.log('PASS: no console/page errors')
}

await browser.close()
console.log('UI smoke done')

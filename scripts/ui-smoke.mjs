/**
 * UI smoke test: boots the real dsh web client in headless Chromium and walks
 * the browser-panel reference-chip workflow — open tab, navigate, pick two
 * elements, expect 元素1/元素2 reference chips inserted into the composer
 * (no attachments), then type an instruction referencing them.
 * Run while `dsh web --patch …` is up:
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
await urlInput.fill("data:text/html,<title>PanelDemo</title><h1 style='margin-top:120px'>dsh panel demo</h1><button id='b1' style='font-size:28px;padding:16px;margin:8px'>PRESS ME</button><input id='i1' placeholder='search-here' style='font-size:22px;padding:12px;margin:8px'/><a href='#' style='font-size:24px;margin:8px;display:inline-block'>a link</a>")
await urlInput.press('Enter')
let sawTitle = false
for (let i = 0; i < 10; i += 1) {
  await page.waitForTimeout(1000)
  if ((await page.locator('text=PanelDemo').count()) > 0) {
    sawTitle = true
    break
  }
}
if (!sawTitle) await fail('panel status bar did not show navigated page title')
console.log('PASS: panel navigated and status bar shows page title')

// 4. Pick mode on; pick two elements — each inserts a 元素N chip, no attachments.
await page.getByRole('button', { name: /选择元素/ }).click()
await page.waitForTimeout(600)
const canvasBox = await canvas.boundingBox()
if (!canvasBox) await fail('canvas bounding box unavailable')
await page.mouse.click(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.22)
await page.waitForTimeout(900)
await page.mouse.click(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.32)
await page.waitForTimeout(900)

const composer = page.locator('[contenteditable="true"]').first()
if (!(await composer.count())) await fail('composer editor not found')
const draftText = (await composer.textContent()) ?? ''
if (!draftText.includes('元素1') || !draftText.includes('元素2')) {
  const notice = await page.locator('div').filter({ hasText: /已插入输入框|插入失败/ }).first().textContent().catch(() => '')
  console.error('panel notice:', JSON.stringify(notice))
  console.error('draft text:', JSON.stringify(draftText.slice(0, 300)))
  await fail('composer draft missing 元素1/元素2 chips after picking')
}
const blobImgs = await page.locator('img[src^="blob:"]').count()
if (blobImgs !== 0) await fail(`expected no attachment previews on chip flow, found ${blobImgs}`)
console.log('PASS: picking inserted 元素1/元素2 chips (no attachments)')

// 5. Type an instruction referencing the chips.
await composer.click()
await page.keyboard.press('End')
await composer.type('把元素1和元素2调换位置')
await page.waitForTimeout(300)
const finalText = (await composer.textContent()) ?? ''
if (!finalText.includes('把元素1和元素2调换位置')) await fail('typed instruction missing from draft')
await page.screenshot({ path: '/tmp/ui-smoke-final.png', fullPage: true })
console.log('PASS: instruction referencing 元素1/元素2 typed into the draft')
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

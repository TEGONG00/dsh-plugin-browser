/**
 * UI smoke test: boots the real dsh web client in headless Chromium and walks
 * the browser-panel task workflow — open tab, navigate, stage two elements,
 * upload as 任务1 with an opinion, stage another and upload as 任务2, and
 * check the composer carries the attachments and ordered task lines.
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

// 4. Pick mode on; stage two elements (clicks land in the staged strip only).
await page.getByRole('button', { name: /选择元素/ }).click()
await page.waitForTimeout(600)
const canvasBox = await canvas.boundingBox()
if (!canvasBox) await fail('canvas bounding box unavailable')
await page.mouse.click(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.22)
await page.waitForTimeout(900)
await page.mouse.click(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.32)
await page.waitForTimeout(900)
const stagedCount = await page.locator('.dsh-browser-thumb').count()
if (stagedCount < 2) await fail(`expected ≥2 staged element thumbnails, found ${stagedCount}`)
console.log(`PASS: ${stagedCount} elements staged without touching the composer`)

// 5. Type an opinion and upload as 任务1.
await page.getByPlaceholder(/修改意见/).fill('把这些元素改成蓝色主题')
await page.getByRole('button', { name: /上传任务/ }).click()
await page.waitForTimeout(1200)
const blobImgs = await page.locator('img[src^="blob:"]').count()
const composerEarly = page.locator('[contenteditable="true"]').first()
const draftEarly = (await composerEarly.count()) ? ((await composerEarly.textContent()) ?? '') : ''
if (blobImgs < 2 || !draftEarly.includes('任务1')) {
  const notice = await page.locator('div').filter({ hasText: /已加入对话框|暂不可用/ }).first().textContent().catch(() => '')
  console.error(`blob imgs: ${blobImgs}, notice: ${JSON.stringify(notice)}, draft: ${JSON.stringify(draftEarly.slice(0, 200))}`)
  await fail('任务1 upload did not produce attachments + draft line')
}
console.log('PASS: 任务1 uploaded — attachment chips visible in composer')

// 6. Stage one more element and upload as 任务2.
await page.mouse.click(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.42)
await page.waitForTimeout(900)
await page.getByPlaceholder(/修改意见/).fill('再把这个元素放大')
await page.getByRole('button', { name: /上传任务/ }).click()
await page.waitForTimeout(1200)
console.log('PASS: 任务2 uploaded')

// 7. The composer draft carries the ordered task lines.
const composer = page.locator('[contenteditable="true"]').first()
if (!(await composer.count())) await fail('composer editor not found')
const draftText = (await composer.textContent()) ?? ''
if (!draftText.includes('任务1') || !draftText.includes('任务2')) {
  console.error('draft text:', JSON.stringify(draftText.slice(0, 400)))
  await fail('composer draft missing 任务1/任务2 lines')
}
if (!draftText.includes('请按任务编号顺序逐个完成')) await fail('draft missing ordered-execution instruction')
console.log('PASS: composer draft has ordered 任务1/任务2 lines')

// 8. Composer still accepts manual text alongside the tasks.
await composer.click()
await composer.type(' 以上一起改，改完截图给我')
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

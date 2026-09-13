import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-attachment'
import { BrowserController } from './browser.ts'
import { Config } from './config.ts'
import { registerTools } from './tools.ts'
import { registerRoutes } from './routes.ts'

export const name = 'dsh-plugin-browser'
// `tools` and `attachments` are required; the web server is composed
// opportunistically so the browser tools still work under headless profiles.
export const inject = ['tools', 'attachments']
export { Config }

export function apply(ctx: Context, config: Config): void {
  const browser = new BrowserController(config)
  ctx.effect(() => {
    const closing = browser.dispose()
    return () => closing
  }, 'dsh-plugin-browser: chromium lifecycle')

  registerTools(ctx, browser)
  ctx.inject(['webServer'], (webCtx) => registerRoutes(webCtx, browser))
}

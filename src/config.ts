import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** Run Chromium headless (default true). */
  headless?: boolean
  /** Viewport of the controlled page. */
  viewport?: { width?: number; height?: number }
  /** Attach to a running browser via CDP instead of launching Chromium. */
  cdpEndpoint?: string
  /** Custom Chromium executable path. */
  executablePath?: string
  /** JPEG quality for screencast frames and screenshots (1-100). */
  jpegQuality?: number
  /** Navigation timeout in milliseconds. */
  navigationTimeoutMs?: number
}

export const Config: Schema<Config> = Schema.object({
  headless: Schema.boolean().default(true).description('Run Chromium headless'),
  viewport: Schema.object({
    width: Schema.number().default(1280),
    height: Schema.number().default(800),
  }).description('Controlled page viewport'),
  cdpEndpoint: Schema.string().description('Connect to a running browser over CDP instead of launching'),
  executablePath: Schema.string().description('Custom Chromium executable'),
  jpegQuality: Schema.number().default(60).min(1).max(100),
  navigationTimeoutMs: Schema.number().default(30_000),
})

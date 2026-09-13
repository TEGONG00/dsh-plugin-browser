import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** Run Chromium headless (default true). */
  headless?: boolean
  /** Viewport of the controlled page (initial; the panel resizes it live). */
  viewport?: { width?: number; height?: number }
  /** Attach to a running browser via CDP instead of launching Chromium. */
  cdpEndpoint?: string
  /** Custom Chromium executable path. */
  executablePath?: string
  /** JPEG quality for screencast frames and screenshots (1-100). */
  jpegQuality?: number
  /** Navigation timeout in milliseconds. */
  navigationTimeoutMs?: number
  /**
   * Try GPU acceleration flags on launch. 'auto' (default) enables them only
   * when a GPU paravirtualization device (/dev/dxg, WSL2) is present; 'on'
   * always; 'off' never. Headless Chromium often falls back to software
   * rendering anyway — the flag is best-effort.
   */
  hardwareAcceleration?: 'auto' | 'on' | 'off'
  /** Persistent browser profile directory (cache/cookies survive restarts). */
  userDataDir?: string
}

export const Config: Schema<Config> = Schema.object({
  headless: Schema.boolean().default(true).description('Run Chromium headless'),
  viewport: Schema.object({
    width: Schema.number().default(1280),
    height: Schema.number().default(800),
  }).description('Initial viewport (the panel resizes it live)'),
  cdpEndpoint: Schema.string().description('Connect to a running browser over CDP instead of launching'),
  executablePath: Schema.string().description('Custom Chromium executable'),
  jpegQuality: Schema.number().default(80).min(1).max(100),
  navigationTimeoutMs: Schema.number().default(30_000),
  hardwareAcceleration: Schema.union(['auto', 'on', 'off']).default('auto').description('GPU flags on launch (auto: only with /dev/dxg)'),
  userDataDir: Schema.string().description('Persistent browser profile dir (default ~/.cache/dsh-plugin-browser/profile)'),
})

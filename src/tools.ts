import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { BrowserController } from './browser.ts'

function baseProperties() {
  return {}
}

export function registerTools(ctx: Context, browser: BrowserController): void {
  ctx.tools.register(defineTool({
    name: 'browser_navigate',
    description: [
      'Open a URL in the built-in browser panel (visible to the user in the dsh web client).',
      'Use it to open the page you are working on so the user can point at elements, and to verify visual changes you made to code.',
    ].join(' '),
    parameters: {
      url: { type: 'string', required: true, description: 'Absolute URL (https://… or http://localhost:…)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Navigated to ${value.url}${value.title ? ` — "${value.title}"` : ''}`,
      }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const status = await browser.goto(args.url)
      return { url: status.url, title: status.title }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_screenshot',
    description: [
      'Take a JPEG screenshot of the built-in browser panel viewport.',
      'Returns a visible image so you can inspect the page the user is looking at, and verify your code changes rendered correctly.',
    ].join(' '),
    parameters: baseProperties(),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          image: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              bytes: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `Screenshot of ${value.url}${value.title ? ` — "${value.title}"` : ''} (${value.image.width}×${value.image.height}), attached above.`,
        },
        {
          type: 'image',
          attachment: {
            attachmentId: value.image.attachmentId as never,
            mediaType: value.image.mediaType as 'image/jpeg',
            bytes: value.image.bytes,
            width: value.image.width,
            height: value.image.height,
          },
        },
      ],
      presentationMeta: (_args, value) => ({
        card: 'browser-screenshot',
        url: value.url,
        title: value.title,
        width: value.image.width,
        height: value.image.height,
        attachmentId: value.image.attachmentId,
      }),
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const page = await browser.ensure()
      const shot = await browser.screenshot()
      const ref = await ctx.attachments.saveImage({
        data: Buffer.from(shot.base64, 'base64'),
        mediaType: 'image/jpeg',
        name: `browser-screenshot-${Date.now()}.jpg`,
      })
      return {
        url: page.url(),
        title: await page.title().catch(() => ''),
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          width: ref.width,
          height: ref.height,
          bytes: ref.bytes,
        },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_snapshot',
    description: [
      'List the interactive elements currently visible in the built-in browser page.',
      'Each line starts with an index like [12]; pass that index to browser_click or browser_type.',
      'Run this again after navigation — indices change.',
    ].join(' '),
    parameters: baseProperties(),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          outline: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Page ${value.url} (${value.title || 'untitled'}) — ${value.count} interactive elements:\n${value.outline}`,
      }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return await browser.snapshotOutline()
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_click',
    description: 'Click an element in the built-in browser by its index from the latest browser_snapshot.',
    parameters: {
      idx: { type: 'integer', required: true, description: 'Element index from browser_snapshot, e.g. 12 for [12]' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Clicked. Now on ${value.url}${value.title ? ` — "${value.title}"` : ''}`,
      }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const status = await browser.clickByIndex(args.idx)
      return { url: status.url, title: status.title }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_type',
    description: 'Replace the text of an input element in the built-in browser and optionally press Enter.',
    parameters: {
      idx: { type: 'integer', required: true, description: 'Element index from browser_snapshot' },
      text: { type: 'string', required: true, description: 'Text to fill into the field' },
      submit: { type: 'boolean', description: 'Press Enter after filling (default false)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Typed into element. Now on ${value.url}${value.title ? ` — "${value.title}"` : ''}`,
      }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const status = await browser.typeByIndex(args.idx, args.text, args.submit)
      return { url: status.url, title: status.title }
    },
  }))
}

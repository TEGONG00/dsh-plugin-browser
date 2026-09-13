/**
 * Injected into the controlled page to power pick-mode: hover outlines plus a
 * capture-phase click interceptor that reports the element through the
 * `__dshBrowserPickReport` binding (exposed once per browser context).
 * Runs entirely in the page — the host only receives the resulting JSON.
 */
export const PICKER_SCRIPT = `
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
      outerHTML: outer.length > 4000 ? outer.slice(0, 4000) + '…' : outer,
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
`

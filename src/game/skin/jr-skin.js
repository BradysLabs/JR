/*
 * JR skin for JR's copy of the AJ Classic launcher (BradysLabs).
 *
 * The launcher is built from web components with their own sealed-off
 * styles. This script runs first and adds JR's monochrome styles to each
 * component as it's created, so the launcher looks like JR and nobody
 * mistakes it for the official Animal Jam app.
 */
(() => {
  'use strict'

  const FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
  const MONO = '"Cascadia Mono", Consolas, monospace'
  const CHECK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.4l2.6 2.6L12 5.6' fill='none' stroke='%230b0b0c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")"

  const SKINS = {
    'ajd-login-screen': `
      :host { background-color: #0b0b0c !important; }
      #box-background { display: none !important; }
      #box {
        width: 520px;
        justify-self: center;
        border-image: none !important;
        background: #0f0f11;
        border: 1px solid #1f1f22;
        border-radius: 22px;
        padding: 52px 70px 40px !important;
        align-items: center;
      }
      #login-container { width: 360px; }
      #login-container > * { margin-bottom: 12px !important; }
      #player-login-text { display: none !important; }
      .jr-head { display: flex; flex-direction: column; align-items: center; margin-bottom: 18px !important; font-family: ${FONT}; }
      .jr-logo { width: 64px; height: 64px; border-radius: 16px; background: #ededee; color: #0b0b0c; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 24px; letter-spacing: -1px; }
      .jr-title { color: #ededee; font-size: 26px; font-weight: 600; letter-spacing: -0.8px; margin-top: 18px; }
      .jr-sub { color: #8a8a90; font-size: 13.5px; margin-top: 6px; text-align: center; }
      .jr-chip { margin-top: 12px; height: 26px; padding: 0 12px 0 4px; border-radius: 999px; border: 1px solid #2a2a2e; display: flex; align-items: center; gap: 7px; color: #a6a6ac; font-size: 12px; }
      .jr-chip i { width: 18px; height: 18px; border-radius: 50%; background: #ededee; color: #0b0b0c; display: flex; align-items: center; justify-content: center; font-style: normal; font-weight: 700; font-size: 10px; }
      ajd-text-input { border-radius: 11px !important; border: none !important; }
      #remember-me-cb { font-size: 13.5px !important; letter-spacing: 0 !important; font-weight: 400 !important; }
      #log-in-btn { padding: 0 !important; }
      #login-btn-container { width: 100%; grid-template-columns: 32px 1fr 32px !important; }
      #forgot-password-link { color: #a6a6ac !important; font-family: ${FONT} !important; font-size: 12.5px !important; letter-spacing: 0 !important; }
      #forgot-password-link:hover { color: #ffffff !important; }
      .vertical-spacer { border-bottom: 1px solid #1f1f22 !important; width: 100% !important; }
      #need-account { color: #6c6c72 !important; font-family: ${FONT} !important; font-weight: 400 !important; font-size: 12.5px !important; letter-spacing: 0 !important; }
      #version-link { color: #5a5a60 !important; font-family: ${MONO} !important; font-size: 11px !important; }
      #spinner { filter: grayscale(1) brightness(2); }
      #button-tray ajd-button { filter: grayscale(1); opacity: .8; }
    `,
    'ajd-text-input': `
      :host { border: 1px solid #2f2f34 !important; border-radius: 11px !important; background-color: #121214 !important; }
      :host(:focus-within) { border-color: #5a5a60 !important; }
      input { color: #ededee !important; font-family: ${FONT} !important; font-size: 15px !important; margin-left: 14px !important; }
      ::placeholder { color: #6c6c72 !important; font-style: normal !important; }
      label { color: #8a8a90 !important; font-family: ${FONT} !important; margin-left: 14px !important; }
    `,
    'ajd-bubble-button': `
      :host {
        background: #f4f4f5 !important; color: #0b0b0c !important; border: 0 !important; box-shadow: none !important;
        font-family: ${FONT} !important; font-size: 15px !important; font-weight: 700 !important; letter-spacing: 0 !important;
        border-radius: 12px !important; padding: 13px 34px !important; min-width: 120px; text-align: center; box-sizing: border-box;
        transition: background .15s;
      }
      :host(:hover) { background: #ffffff !important; border: 0 !important; box-shadow: none !important; }
      :host(:active) { background: #d4d4d8 !important; transform: translateY(1px); }
      :host([disabled]) { background: #2a2a2e !important; color: #6c6c72 !important; box-shadow: none !important; border: 0 !important; }
      :host(#create-account-btn) { background: transparent !important; color: #d4d4d8 !important; border: 1px solid #2f2f34 !important; font-weight: 600 !important; font-size: 14px !important; padding: 11px 26px !important; }
      :host(#create-account-btn:hover) { border-color: #4a4a50 !important; color: #ffffff !important; }
      :host(#log-in-btn) { width: 100%; }
    `,
    'ajd-checkbox': `
      :host { color: #a6a6ac !important; font-family: ${FONT} !important; font-size: 13.5px !important; letter-spacing: 0 !important; align-items: center; --checkbox-width: 18px; }
      #cb { width: 18px !important; height: 18px; border-radius: 5px; border: 1.5px solid #3a3a40; background: transparent !important; box-sizing: border-box; }
      #cb.checked { background: #ededee ${CHECK} center / 14px no-repeat !important; border-color: #ededee; }
      #text { margin-left: 9px !important; margin-top: 0 !important; }
    `,
    'ajd-error-tip': `
      #text { background: #1a1a1d !important; border: 1px solid #5b2a2f !important; color: #fecaca !important; font-family: ${FONT} !important; text-shadow: none !important; letter-spacing: 0 !important; border-radius: 10px !important; box-shadow: 0 8px 24px rgba(0,0,0,.5) !important; }
      #tip { border-left-color: #5b2a2f !important; }
    `,
    'ajd-message-modal': `
      #modal-body { background: #111113 !important; border: 1px solid #2a2a2e !important; border-radius: 18px !important; color: #d4d4d8 !important; font-family: ${FONT} !important; font-size: 15px !important; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
      #header-div { font-family: ${FONT} !important; font-size: 22px !important; font-weight: 600; color: #ededee !important; text-shadow: none !important; border-bottom: 1px solid #1f1f22 !important; padding: 18px !important; }
      #body-div { line-height: 1.55; }
    `,
    'ajd-game-screen': `
      #game-background { background: #0b0b0c; }
      #border-top, #border-bottom, #border-left, #border-right { visibility: hidden !important; }
      #border-top-background, #border-bottom-background, #border-left-background, #border-right-background { background: #0b0b0c !important; }
      #floating-button-tray { filter: grayscale(1) brightness(.9); }
    `,
    'ajd-game-button-tray': `
      #buttons-tray-container, #expand-tray { filter: grayscale(1); }
    `
  }

  // Add JR's styles to every component the launcher creates.
  const original = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (init) {
    const root = original.call(this, init)
    const css = SKINS[this.localName]
    if (css) {
      try {
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(css)
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
      } catch (_) {}
    }
    return root
  }

  // Page background and title.
  const page = document.createElement('style')
  page.textContent = `
    body { background-color: #0b0b0c !important; background-image: none !important; }
    #modal-layer { background-color: rgba(0, 0, 0, .7) !important; }
  `
  document.documentElement.appendChild(page)

  const profileName = () => {
    try { return (window.globals && window.globals.config && window.globals.config.jrProfile) || (globals && globals.config && globals.config.jrProfile) || '' } catch (_) { return '' }
  }
  const title = () => {
    const name = profileName()
    const want = name ? `JR · ${name}` : 'JR'
    if (document.title !== want) document.title = want
  }
  title()
  setInterval(title, 1000)

  // JR heading on the login screen.
  const addHeading = () => {
    const screen = document.getElementById('login-screen')
    const root = screen && screen.shadowRoot
    const container = root && root.getElementById('login-container')
    if (!container) return false
    let head = root.querySelector('.jr-head')
    if (!head) {
      head = document.createElement('div')
      head.className = 'jr-head'
      head.innerHTML = '<div class="jr-logo">JR</div><div class="jr-title">Sign in to Animal Jam</div><div class="jr-sub">Use your Animal Jam username and password. JR never sees your password.</div><div class="jr-chip" hidden><i></i><span></span></div>'
      container.prepend(head)
    }
    const name = profileName()
    const chip = head.querySelector('.jr-chip')
    if (name) {
      chip.hidden = false
      chip.querySelector('i').textContent = name[0].toUpperCase()
      chip.querySelector('span').textContent = `JR profile: ${name}`
    }
    return !!name
  }
  const timer = setInterval(() => { if (addHeading()) clearInterval(timer) }, 200)
  setTimeout(() => clearInterval(timer), 30000)
})()

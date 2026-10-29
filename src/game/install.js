'use strict'

/**
 * JR's copy of AJ Classic.
 *
 * JR never ships WildWorks' files. Instead, on the user's computer, it copies
 * the official AJ Classic install into JR's own folder and makes three small
 * changes to that copy:
 *
 *   config.js       turn off the copy's auto-updater (the official install
 *                   keeps updating itself as normal)
 *   index.js        read --jr-api and --jr-user-data, so each JR profile has
 *                   its own game login data and knows where JR is
 *   GameScreen.js   before the game starts, ask JR which server address to
 *                   use (JR's proxy) instead of Animal Jam's; and draw JR's
 *                   worth bubble when you hover an item
 *   gamePreload.js  let the game tell this page which item is under the
 *                   mouse (JR's game file patch calls jrItemOver/jrItemOut)
 *
 * When the official install changes version, JR rebuilds its copy.
 *
 * Windows: AJ Classic is a folder with "AJ Classic.exe" and resources/app.asar.
 * Mac: AJ Classic is "AJ Classic.app"; the archive is in Contents/Resources and
 * the program in Contents/MacOS. The Mac copy keeps the bundle's symlinks,
 * updates the archive's checksum in Info.plist, and is signed again "ad hoc"
 * (macOS won't open a changed app otherwise).
 */

const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { spawn, spawnSync } = require('child_process')
const fs = (() => { try { return require('original-fs') } catch (_) { return require('fs') } })()
// JR's own files may sit inside JR's app.asar once installed; plain fs can read those.
const jrFs = require('fs')
const asar = require('./asar')

const PATCH_VERSION = 10
const EXE = 'AJ Classic.exe'
const MAC_APP = 'AJ Classic.app'

/**
 * Where things are inside an AJ Classic install, per platform.
 * resources: the folder holding app.asar; exe(root): the program to run.
 */
function layoutFor (platform = process.platform) {
  if (platform === 'darwin') {
    return {
      platform,
      resources: 'Contents/Resources',
      exe: (root) => path.join('Contents', 'MacOS', macExecutable(root)),
      copyRoot: (dir) => path.join(dir, MAC_APP) // the copy stays a .app bundle
    }
  }
  return { platform, resources: 'resources', exe: () => EXE, copyRoot: (dir) => dir }
}

/** The program name inside a Mac app, from its Info.plist (or the only file in Contents/MacOS). */
function macExecutable (appDir) {
  try {
    const plist = fs.readFileSync(path.join(appDir, 'Contents', 'Info.plist'), 'utf8')
    const m = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)
    if (m) return m[1]
  } catch (_) {}
  try {
    const files = fs.readdirSync(path.join(appDir, 'Contents', 'MacOS'))
    if (files.length) return files.includes('AJ Classic') ? 'AJ Classic' : files[0]
  } catch (_) {}
  return 'AJ Classic'
}

const isInstall = (dir, layout) => {
  try { return fs.existsSync(path.join(dir, layout.resources, 'app.asar')) && fs.existsSync(path.join(dir, layout.exe(dir))) } catch (_) { return false }
}

/** Where the official AJ Classic is usually installed. */
function findOfficial ({ platform = process.platform, env = process.env, home = os.homedir(), appFolders } = {}) {
  const layout = layoutFor(platform)
  const candidates = []
  if (platform === 'darwin') {
    // Usually /Applications/AJ Classic.app; also look for anything named like it.
    for (const folder of appFolders || ['/Applications', path.join(home, 'Applications')]) {
      candidates.push(path.join(folder, MAC_APP))
      try {
        for (const name of fs.readdirSync(folder)) {
          if (/\.app$/i.test(name) && /aj classic|animal jam/i.test(name) && name !== MAC_APP) candidates.push(path.join(folder, name))
        }
      } catch (_) {}
    }
  } else {
    if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'aj-classic'))
    candidates.push(path.join(home, 'AppData', 'Local', 'Programs', 'aj-classic'))
    if (env.PROGRAMFILES) candidates.push(path.join(env.PROGRAMFILES, 'AJ Classic'))
  }
  return candidates.find(dir => isInstall(dir, layout)) || null
}

/* ---------------------------------------------------------------- patches */

const JR_INDEX = `
;(() => {
  // Added by JR (BradysLabs): lets JR run this copy for a JR profile.
  const arg = (name) => {
    const hit = process.argv.find(a => a.startsWith('--' + name + '='))
    return hit ? hit.slice(name.length + 3) : null
  }
  config.jrApi = arg('jr-api')
  config.jrToken = arg('jr-token')
  config.jrProfile = arg('jr-profile')
  // Smooth play: the game keeps full speed when its window is behind another
  // one or not focused, and draws with the graphics card where it can.
  for (const s of ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows', 'ignore-gpu-blocklist']) {
    try { app.commandLine.appendSwitch(s) } catch (_) {}
  }
  app.on('web-contents-created', (_, contents) => {
    try { if (contents.setBackgroundThrottling) contents.setBackgroundThrottling(false) } catch (_) {}
  })
  // F2 saves a screenshot of the game to Pictures\\Animal Jam Screenshots
  // and copies it, so it can be pasted straight into Discord.
  const screenshot = async (contents) => {
    const electron = require('electron')
    const page = contents.hostWebContents || contents
    const say = (text) => page.executeJavaScript('window.jrIngame && window.jrIngame.say && window.jrIngame.say(' + JSON.stringify(text) + ')').catch(() => {})
    try {
      const game = contents.hostWebContents ? contents
        : electron.webContents.getAllWebContents().find(w => w.hostWebContents === contents) || contents
      const image = await game.capturePage()
      if (image.isEmpty()) throw new Error('nothing to capture yet')
      const fs = require('fs')
      const path = require('path')
      const dir = path.join(app.getPath('pictures'), 'Animal Jam Screenshots')
      fs.mkdirSync(dir, { recursive: true })
      const d = new Date()
      const two = (n) => String(n).padStart(2, '0')
      const name = 'AJ ' + d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + '.' + two(d.getMinutes()) + '.' + two(d.getSeconds()) + '.png'
      fs.writeFileSync(path.join(dir, name), image.toPNG())
      electron.clipboard.writeImage(image)
      say('Screenshot saved and copied: ' + name)
    } catch (e) {
      say('Screenshot failed: ' + (e && e.message))
    }
  }
  app.on('web-contents-created', (_, contents) => {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F2' && !input.control && !input.meta && !input.shift && !input.alt) {
        event.preventDefault()
        if (!input.isAutoRepeat) screenshot(contents)
        return
      }
      // Ctrl+K opens JR's command palette, even while the game has the keyboard.
      if (!(input.control || input.meta) || input.shift || input.alt) return
      if (String(input.key).toLowerCase() !== 'k') return
      event.preventDefault()
      const page = contents.hostWebContents || contents
      page.executeJavaScript('window.jrIngame && window.jrIngame.palette()').catch(() => {})
    })
  })
  const userData = arg('jr-user-data')
  if (userData) app.setPath('userData', userData)
})();
`

const JR_GAME_SCREEN = `
// Added by JR (BradysLabs): asks JR for the address of its game proxy.
window.jrPrepare = async (flashVars) => {
  const api = globals.config && globals.config.jrApi
  if (!api) return flashVars
  const wanted = /^(smartfoxServer\\d*|smartfoxPort|blueboxServer\\d*|blueboxPort|ingressXt|ingressHProxy|content|clientURL|mdUrl|deploy_version|website)$/
  const send = {}
  for (const key of Object.keys(flashVars)) if (wanted.test(key)) send[key] = flashVars[key]
  const response = await fetch(api + '/game/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(send)
  })
  if (!response.ok) throw new Error('JR answered ' + response.status)
  return Object.assign({}, flashVars, await response.json())
};
`

const JR_GAME_PRELOAD = `
// Added by JR (BradysLabs): the game says which item is under the mouse, for
// JR's worth bubble. Only numbers and short text are passed on.
const jrValue = (v) => (typeof v === "number" && isFinite(v)) ? v : (typeof v === "string" ? v.slice(0, 120) : null);
contextBridge.exposeInMainWorld("jrItemOver", (...args) => ipcRenderer.sendToHost("jrItemOver", ...args.slice(0, 7).map(jrValue)));
contextBridge.exposeInMainWorld("jrItemOut", () => ipcRenderer.sendToHost("jrItemOut"));

// Added by JR (BradysLabs): JR's rows in the game's own Settings window. The
// game asks for them as the window opens and needs an answer right away, so
// JR keeps a current copy here; switching one tells JR.
let jrRows = [];
ipcRenderer.on("jrSettings", (event, rows) => {
  if (!Array.isArray(rows)) return;
  if (!jrRows.length && rows.length) ipcRenderer.sendToHost("jrDebug", "The game page has JR's " + rows.length + " Settings rows.");
  jrRows = rows.slice(0, 20);
});
contextBridge.exposeInMainWorld("jrSettingsRows", () => (ipcRenderer.sendToHost("jrDebug", "The game asked for JR's Settings rows; the page has " + jrRows.length + "."), jrRows).map(r => ({
  type: 0, frame: String(r.frame), labelTxt: String(r.labelTxt).slice(0, 40),
  onTxt: String(r.onTxt || "On"), offTxt: String(r.offTxt || "Off"), key: String(r.key), value: !!r.value
})));
contextBridge.exposeInMainWorld("jrSettingToggle", (key, value) => ipcRenderer.sendToHost("jrSettingToggle", String(key).slice(0, 60), !!value));

// Added by JR (BradysLabs): JR serves the game file from this computer, so
// the page's Flash object has to allow the game to call the page (JR's hooks
// above); without it Flash refuses those calls. Set as the object is added,
// before Flash starts it. Only the game file's own object is changed.
const jrScriptAccess = (el) => {
  try {
    if (el.tagName !== "OBJECT" && el.tagName !== "EMBED") return;
    const movie = el.tagName === "OBJECT" ? [...el.querySelectorAll("param")].find(p => /^movie$/i.test(p.name)) : null;
    const src = el.getAttribute("data") || el.getAttribute("src") || (movie ? movie.value : "") || "";
    if (!/ajclient/i.test(src) || el.dataset.jrAccess) return;
    el.dataset.jrAccess = "1";
    let before = el.getAttribute("allowscriptaccess");
    if (el.tagName === "OBJECT") {
      let param = [...el.querySelectorAll("param")].find(p => /^allowscriptaccess$/i.test(p.name));
      if (param) before = param.value;
      else { param = document.createElement("param"); param.name = "allowScriptAccess"; el.appendChild(param); }
      param.value = "always";
    }
    el.setAttribute("allowscriptaccess", "always");
    ipcRenderer.sendToHost("jrDebug", "Game object on " + location.origin + " (" + el.tagName.toLowerCase() + "), script access was " + (before || "not set") + ", now always.");
  } catch (err) {
    ipcRenderer.sendToHost("jrDebug", "Couldn't set the game's script access: " + err.message);
  }
};
new MutationObserver(changes => {
  for (const change of changes) for (const node of change.addedNodes) {
    if (node.nodeType !== 1) continue;
    jrScriptAccess(node);
    if (node.querySelectorAll) node.querySelectorAll("object, embed").forEach(jrScriptAccess);
  }
}).observe(document, { childList: true, subtree: true });

`

const JR_WORTH_BUBBLE = `
// Added by JR (BradysLabs): the worth bubble. JR's copy of the game file
// reports the hovered item (id, color, mouse position on the game's stage);
// this asks JR what it's worth and shows it beside the mouse.
window.jrWatchGame = (screen) => {
  const webview = screen.webViewElem;
  const api = () => globals.config && globals.config.jrApi;
  if (!webview || !screen.shadowRoot) return;
  const style = document.createElement("style");
  style.textContent = \`
    #jr-worth { position: fixed; z-index: 2147483647; display: none; pointer-events: none; width: 264px; box-sizing: border-box;
      padding: 10px 12px; border-radius: 10px; background: rgba(15,15,17,0.97); border: 1px solid #2a2a2e; color: #ededee;
      font: 13px/1.35 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
    #jr-worth .head { display: flex; gap: 10px; align-items: center; }
    #jr-worth img { width: 44px; height: 44px; object-fit: contain; background: #18181b; border-radius: 8px; flex: none; }
    #jr-worth .name { font-weight: 600; font-size: 13.5px; }
    #jr-worth .sub { color: #a1a1a8; font-size: 11.5px; }
    #jr-worth .dia { margin-top: 8px; font-size: 17px; font-weight: 650; letter-spacing: -0.01em; }
    #jr-worth .bl { color: #c8c8cd; font-size: 12px; }
    #jr-worth .lines { margin-top: 8px; padding-top: 7px; border-top: 1px solid #232327; }
    #jr-worth .line { color: #c8c8cd; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #jr-worth .more, #jr-worth .foot { color: #77777e; font-size: 10.5px; margin-top: 4px; }
    #jr-worth .none { color: #a1a1a8; margin-top: 6px; font-size: 12px; }
  \`;
  const bubble = document.createElement("div");
  bubble.id = "jr-worth";
  screen.shadowRoot.append(style, bubble);

  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const num = (n) => n >= 100 ? (Math.round(n / 5) * 5).toLocaleString() : n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
  const scopeText = { color: "This color", "all colors": "Range across all colors", "all versions": "Range across all versions" };
  const render = (d) => {
    const sub = [d.color, scopeText[d.scope]].filter(Boolean).join(" \\u00b7 ");
    let html = '<div class="head">' + (d.image ? '<img src="' + esc(d.image) + '">' : "") +
      '<div><div class="name">' + esc(d.name) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + "</div>" : "") + "</div></div>";
    if (!d.matched) return html + '<div class="none">Not on the Item Worth Wiki.</div>';
    if (d.diamonds) {
      const a = num(d.diamonds.min), b = num(d.diamonds.max);
      html += '<div class="dia">\\u2248 ' + (a === b ? a : a + "\\u2013" + b) + " Diamonds</div>";
      if (d.bl >= 0.1) html += '<div class="bl">\\u2248 ' + (d.bl >= 10 ? Math.round(d.bl) : Math.round(d.bl * 10) / 10) + " Black Long collars</div>";
    }
    html += '<div class="lines">' + d.lines.map(l => '<div class="line">' + esc(l) + "</div>").join("") +
      (d.more ? '<div class="more">+' + d.more + " more on the wiki</div>" : "") + "</div>";
    return html + '<div class="foot">Item Worth Wiki' + (d.updated ? " \\u00b7 updated " + esc(d.updated) : "") + " \\u00b7 JR</div>";
  };
  const place = (mx, my, sw, sh) => {
    const r = webview.getBoundingClientRect();
    const w = Number(sw) || 900, h = Number(sh) || 550;
    const scale = Math.min(r.width / w, r.height / h);
    const px = r.left + (r.width - w * scale) / 2 + Number(mx) * scale;
    const py = r.top + (r.height - h * scale) / 2 + Number(my) * scale;
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let x = px + 18, y = py + 18;
    if (x + bw > r.right - 6) x = px - bw - 18;
    if (y + bh > r.bottom - 6) y = py - bh - 18;
    bubble.style.left = Math.max(r.left + 6, x) + "px";
    bubble.style.top = Math.max(r.top + 6, y) + "px";
  };
  let seq = 0;
  const cache = new Map();
  const hide = () => { seq++; bubble.style.display = "none"; };
  webview.addEventListener("ipc-message", async event => {
    if (event.channel === "jrItemOut") return hide();
    if (event.channel !== "jrItemOver" || !api()) return;
    const [defId, color, name, mx, my, sw, sh] = event.args;
    const key = defId + ":" + color + ":" + name;
    const mine = ++seq;
    let data = cache.get(key);
    if (!data) {
      try {
        const q = "defId=" + encodeURIComponent(defId) + "&color=" + encodeURIComponent(color) + "&name=" + encodeURIComponent(name || "");
        data = await (await fetch(api() + "/jr/worth?" + q)).json();
      } catch (_) { return; }
      cache.set(key, data);
    }
    if (mine !== seq || !data || !data.found) return;
    bubble.innerHTML = render(data);
    bubble.style.display = "block";
    place(mx, my, sw, sh);
  });
  webview.addEventListener("did-start-loading", hide);
};
`

/** The edits, as exact text replacements. Fails loudly if AJ changed. */
const PATCHES = {
  'config.js': [
    ['noUpdater: false', 'noUpdater: true']
  ],
  'index.js': [
    ['const config = require("./config.js");', 'const config = require("./config.js");' + JR_INDEX],
    ['backgroundColor: "#F5C86D"', 'backgroundColor: "#0b0b0c"']
  ],
  'gui/index.html': [
    ['<title>Animal Jam Classic</title>', '<title>JR</title>\n    <script src="jr-skin.js"></script>\n    <script src="jr-ingame.js"></script>']
  ],
  'gui/gamePreload.js': [
    ['ipcRenderer.on("redirect-url", (event, url) => {', JR_GAME_PRELOAD + 'ipcRenderer.on("redirect-url", (event, url) => {']
  ],
  'gui/components/GameScreen.js': [
    ['"use strict";', '"use strict";\n' + JR_GAME_SCREEN + JR_WORTH_BUBBLE],
    [
      'this.webViewElem.addEventListener("ipc-message", async event => {',
      'try { window.jrWatchGame(this); } catch (err) { console.error("JR worth bubble:", err); }\n      this.webViewElem.addEventListener("ipc-message", async event => {'
    ],
    [
      'this.webViewElem.send("flashVarsReady", flashVars);',
      'window.jrPrepare(flashVars).then(fv => this.webViewElem.send("flashVarsReady", fv)).catch(err => globals.genericError("JR could not start the game: " + err.message));'
    ]
  ]
}

function applyPatches (file, text) {
  for (const [find, replace] of PATCHES[file] || []) {
    const at = text.indexOf(find)
    if (at === -1 || text.indexOf(find, at + 1) !== -1) {
      throw new Error(`AJ Classic has changed (${file}). JR needs an update to support this version.`)
    }
    text = text.slice(0, at) + replace + text.slice(at + find.length)
  }
  return text
}

/** Reads the official app.asar and returns the patched files. */
function patchedArchive (officialAsar) {
  const archive = asar.open(officialAsar)
  try {
    const files = []
    const executable = new Set()
    for (const p of archive.list()) {
      let data = archive.read(p)
      if (PATCHES[p]) data = Buffer.from(applyPatches(p, data.toString('utf8')), 'utf8')
      const e = archive.entry(p)
      if (e.executable) executable.add(p)
      files.push([p, data])
    }
    for (const p of Object.keys(PATCHES)) {
      if (!files.some(([q]) => q === p)) throw new Error(`AJ Classic has changed (${p} is missing).`)
    }
    // JR's look: its skin script and its icon.
    const add = (p, data) => {
      const i = files.findIndex(([q]) => q === p)
      if (i === -1) files.push([p, data]); else files[i] = [p, data]
    }
    add('gui/jr-skin.js', jrFs.readFileSync(path.join(__dirname, 'skin', 'jr-skin.js')))
    add('gui/jr-ingame.js', jrFs.readFileSync(path.join(__dirname, 'skin', 'jr-ingame.js')))
    const icon = path.join(__dirname, '..', '..', 'assets', 'icon.png')
    if (jrFs.existsSync(icon)) {
      add('gui/images/icon.png', jrFs.readFileSync(icon))
      add('gui/icon.png', jrFs.readFileSync(icon))
    }
    return { files, executable }
  } finally {
    archive.close()
  }
}

/* ---------------------------------------------------------------- install */

function stampOf (officialDir, layout = layoutFor()) {
  const exe = fs.statSync(path.join(officialDir, layout.exe(officialDir)))
  const app = fs.statSync(path.join(officialDir, layout.resources, 'app.asar'))
  return `${PATCH_VERSION}:${exe.size}:${Math.round(exe.mtimeMs)}:${app.size}:${Math.round(app.mtimeMs)}`
}

/** Runs a command; throws with its output if it fails. */
function runCommand (cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || r.stdout || '').trim()}`)
  return r.stdout
}

/**
 * Electron checks app.asar against a checksum in the Mac app's Info.plist
 * (when the app turns that check on). Puts the new archive's checksum there.
 * @returns {boolean} whether a checksum was found and updated
 */
function updateAsarIntegrity (appDir, asarFile, run = runCommand) {
  const plistFile = path.join(appDir, 'Contents', 'Info.plist')
  if (!fs.existsSync(plistFile)) return false
  let text = fs.readFileSync(plistFile, 'utf8')
  if (!text.startsWith('<?xml') && !text.includes('<plist')) {
    run('plutil', ['-convert', 'xml1', plistFile]) // binary plist -> text
    text = fs.readFileSync(plistFile, 'utf8')
  }
  const re = /(<key>ElectronAsarIntegrity<\/key>\s*<dict>[\s\S]*?<key>Resources\/app\.asar<\/key>\s*<dict>[\s\S]*?<key>hash<\/key>\s*<string>)([0-9a-fA-F]+)(<\/string>)/
  if (!re.test(text)) return false
  fs.writeFileSync(plistFile, text.replace(re, `$1${asar.headerHash(asarFile)}$3`))
  return true
}

/** Lets macOS open the changed copy: clear the download flag and sign it ad hoc. */
function signMacCopy (appDir, run = runCommand) {
  try { run('xattr', ['-cr', appDir]) } catch (_) {}
  try {
    run('codesign', ['--force', '--deep', '--sign', '-', appDir])
  } catch (error) {
    throw new Error(`macOS wouldn't let JR prepare its copy of AJ Classic (${error.message}).`)
  }
}

/**
 * Makes sure JR's copy of the game exists and matches the official install.
 * @param {{officialDir?: string, gameDir: string, log?: Function}} options
 *
 * Each build lives in its own folder, named after what it was built from
 * (<gameDir>-<id>), so a new build never has to delete a folder a running
 * game still has open, and two JR builds with different patches never
 * overwrite each other's copy. Older copies are removed when they're free.
 * @returns {{gameDir: string, exe: string, rebuilt: boolean}} gameDir is the
 *   folder actually used
 */
function ensureGame ({ officialDir, gameDir: base, log = () => {}, platform = process.platform, run = runCommand }) {
  const layout = layoutFor(platform)
  if (officialDir === undefined) officialDir = findOfficial({ platform })
  if (!officialDir) {
    throw new Error(platform === 'darwin'
      ? 'AJ Classic isn\'t installed. Install it from animaljam.com (it goes in Applications), then open JR again.'
      : 'AJ Classic isn\'t installed. Install it from animaljam.com, then open JR again.')
  }
  const stamp = stampOf(officialDir, layout)
  const gameDir = `${base}-${crypto.createHash('sha1').update(stamp).digest('hex').slice(0, 10)}`
  const stampFile = path.join(gameDir, 'jr-game.json')
  let current = null
  try { current = JSON.parse(fs.readFileSync(stampFile, 'utf8')).stamp } catch (_) {}
  const exeRel = layout.exe(officialDir)
  const exe = path.join(layout.copyRoot(gameDir), exeRel)
  if (current === stamp && fs.existsSync(exe)) {
    removeOldCopies(base, gameDir)
    return { gameDir, exe, rebuilt: false }
  }

  log({ type: 'notify', message: 'Setting up JR\'s copy of AJ Classic…' })
  const tmp = `${gameDir}.building`
  const root = layout.copyRoot(tmp)
  const res = layout.resources
  fs.rmSync(tmp, { recursive: true, force: true })
  copyDir(officialDir, root, (rel) => {
    const r = rel.replace(/\\/g, '/')
    return r !== `${res}/app.asar` && !r.startsWith(`${res}/app.asar.unpacked`) && !/^Uninstall /i.test(r)
  })
  const asarFile = path.join(root, res, 'app.asar')
  const { files, executable } = patchedArchive(path.join(officialDir, res, 'app.asar'))
  asar.write(asarFile, files, { executable })
  if (platform === 'darwin') {
    updateAsarIntegrity(root, asarFile, run)
    signMacCopy(root, run)
  }
  fs.writeFileSync(path.join(tmp, 'jr-game.json'), JSON.stringify({ stamp, officialDir, builtAt: new Date().toISOString() }, null, 2))

  fs.rmSync(gameDir, { recursive: true, force: true })
  fs.renameSync(tmp, gameDir)
  removeOldCopies(base, gameDir)
  log({ type: 'success', message: 'JR\'s copy of AJ Classic is ready.' })
  return { gameDir, exe, rebuilt: true }
}

/**
 * Removes earlier copies (<base>-<id>) other than `keep`. A copy a running
 * game still has open is left for next time. The plain <base> folder is
 * never touched: older JR versions on this computer still use it.
 */
function removeOldCopies (base, keep) {
  const parent = path.dirname(base)
  const prefix = path.basename(base) + '-'
  let names = []
  try { names = fs.readdirSync(parent) } catch (_) { return }
  for (const name of names) {
    const full = path.join(parent, name)
    if (!name.startsWith(prefix) || full === keep || name.endsWith('.building')) continue
    try { fs.rmSync(full, { recursive: true, force: true }) } catch (_) {}
  }
}

/** Copies a folder. Keeps symlinks as symlinks (Mac apps rely on them) and file permissions. */
function copyDir (from, to, keep, rel = '') {
  fs.mkdirSync(path.join(to, rel), { recursive: true })
  for (const e of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name)
    if (!keep(r)) continue
    const src = path.join(from, r)
    const dest = path.join(to, r)
    if (e.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dest)
    else if (e.isDirectory()) copyDir(from, to, keep, r)
    else if (e.isFile()) {
      fs.copyFileSync(src, dest)
      try { fs.chmodSync(dest, fs.statSync(src).mode & 0o777) } catch (_) {}
    }
  }
}

/**
 * Starts JR's copy of the game for one profile.
 * @returns {import('child_process').ChildProcess}
 */
function launch ({ exe, apiUrl, userDataDir, profileName = '', token = '' }) {
  fs.mkdirSync(userDataDir, { recursive: true })
  const args = [`--jr-api=${apiUrl}`, `--jr-user-data=${userDataDir}`]
  if (token) args.push(`--jr-token=${token}`)
  if (profileName) args.push(`--jr-profile=${profileName}`)
  const child = spawn(exe, args, {
    cwd: path.dirname(exe),
    detached: false,
    stdio: 'ignore',
    windowsHide: false
  })
  return child
}

module.exports = { findOfficial, ensureGame, launch, patchedArchive, applyPatches, PATCHES, layoutFor, macExecutable, updateAsarIntegrity }

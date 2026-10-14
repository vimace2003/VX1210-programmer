// CE42 Next desktop shell: hosts the web app (apps/web build, copied to ./renderer) in an
// Electron window and answers the Web Serial port chooser with a native dialog.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SCHEME = "app";
const ORIGIN = `${SCHEME}://ce42`;
const RENDERER = path.join(__dirname, "renderer");
// Test hook: keep the window hidden (used by scripts/smoke-test.mjs with --remote-debugging-port)
const HIDDEN = process.env.CE42_HIDDEN_WINDOW === "1";

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Test mode uses a throw-away profile: it neither touches the user's settings nor collides
// with a copy the user has open (the single-instance lock is per profile).
if (HIDDEN) app.setPath("userData", path.join(require("node:os").tmpdir(), `ce42next-smoke-${process.pid}`));

if (!app.requestSingleInstanceLock()) app.quit();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";

const TEXT = {
  pt: {
    choosePort: "Escolha a porta do cabo de programação",
    choosePortDetail: "Cabo SVC-1200 ou adaptador USB-serial ligado ao conector MIC do VX-1210.",
    noPorts: "Nenhuma porta serial encontrada",
    noPortsDetail: "Conecte o cabo de programação (e instale o driver do adaptador USB-serial, se houver) e tente de novo.",
    cancel: "Cancelar",
    unsaved: "Há alterações não salvas.",
    unsavedDetail: "Se fechar agora, as alterações serão perdidas.",
    quit: "Fechar sem salvar",
  },
  en: {
    choosePort: "Choose the programming cable port",
    choosePortDetail: "SVC-1200 cable or USB-serial adapter connected to the VX-1210 MIC jack.",
    noPorts: "No serial port found",
    noPortsDetail: "Connect the programming cable (and install the USB-serial adapter driver, if any) and try again.",
    cancel: "Cancel",
    unsaved: "There are unsaved changes.",
    unsavedDetail: "If you close now, the changes will be lost.",
    quit: "Close without saving",
  },
  es: {
    choosePort: "Elija el puerto del cable de programación",
    choosePortDetail: "Cable SVC-1200 o adaptador USB-serie conectado al conector MIC del VX-1210.",
    noPorts: "No se encontró ningún puerto serie",
    noPortsDetail: "Conecte el cable de programación (e instale el controlador del adaptador USB-serie, si lo hay) e intente de nuevo.",
    cancel: "Cancelar",
    unsaved: "Hay cambios sin guardar.",
    unsavedDetail: "Si cierra ahora, los cambios se perderán.",
    quit: "Cerrar sin guardar",
  },
  ru: {
    choosePort: "Выберите порт кабеля программирования",
    choosePortDetail: "Кабель SVC-1200 или USB-COM адаптер, подключённый к разъёму MIC рации VX-1210.",
    noPorts: "Последовательные порты не найдены",
    noPortsDetail: "Подключите кабель программирования (и установите драйвер USB-COM адаптера, если нужен) и повторите попытку.",
    cancel: "Отмена",
    unsaved: "Есть несохранённые изменения.",
    unsavedDetail: "Если закрыть сейчас, изменения будут потеряны.",
    quit: "Закрыть без сохранения",
  },
};
// Language chosen in the app (start-up screen / toolbar); system language until then.
let uiLang = null;
function t() {
  if (uiLang && TEXT[uiLang]) return TEXT[uiLang];
  const sys = app.getLocale().toLowerCase().slice(0, 2);
  return TEXT[sys] ?? TEXT.en;
}

// Remember the chosen port so navigator.serial.getPorts() returns it after a restart.
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}
function saveSettings(patch) {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), ...patch }, null, 2));
  } catch {
    /* settings are a convenience only */
  }
}
const portKey = (p) => p && { portName: p.portName ?? "", vendorId: p.vendorId ?? "", productId: p.productId ?? "", serialNumber: p.serialNumber ?? "" };
function samePort(a, b) {
  const x = portKey(a), y = portKey(b);
  return !!x && !!y && x.portName === y.portName && x.vendorId === y.vendorId && x.productId === y.productId && x.serialNumber === y.serialNumber;
}

let win = null;

function servePage(request) {
  const url = new URL(request.url);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = path.normalize(path.join(RENDERER, rel));
  if (!file.startsWith(RENDERER + path.sep) && file !== RENDERER) return new Response("forbidden", { status: 403 });
  try {
    const body = fs.readFileSync(file);
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    return new Response(body, { headers: { "content-type": type, "content-security-policy": CSP } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

function setupSession() {
  const ses = session.defaultSession;
  const ours = (origin) => typeof origin === "string" && origin.startsWith(ORIGIN);
  const allowed = new Set(["serial", "fileSystem", "clipboard-sanitized-write"]);
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && ours(origin));
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowed.has(permission) && ours(details.requestingUrl)));
  ses.setDevicePermissionHandler((details) => details.deviceType === "serial" && ours(details.origin) && samePort(loadSettings().lastPort, details.device));

  ses.on("select-serial-port", (event, portList, _webContents, callback) => {
    event.preventDefault();
    const text = t();
    if (portList.length === 0) {
      dialog.showMessageBox(win, { type: "info", title: "CE42 Next", message: text.noPorts, detail: text.noPortsDetail }).finally(() => callback(""));
      return;
    }
    const ports = [...portList].sort((a, b) => (a.portName ?? "").localeCompare(b.portName ?? "", undefined, { numeric: true }));
    const labels = ports.map((p) => (p.displayName && p.displayName !== p.portName ? `${p.portName} — ${p.displayName}` : p.portName || p.portId));
    const last = ports.findIndex((p) => samePort(loadSettings().lastPort, p));
    dialog.showMessageBox(win, {
      type: "question", title: "CE42 Next", message: text.choosePort, detail: text.choosePortDetail,
      buttons: [...labels, text.cancel], cancelId: labels.length, defaultId: last >= 0 ? last : 0,
    }).then(({ response }) => {
      const p = ports[response];
      if (!p) return callback("");
      saveSettings({ lastPort: portKey(p) });
      callback(p.portId);
    }, () => callback(""));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: "CE42 Next", show: false, backgroundColor: "#161b12",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
      // serial transfers must not be slowed down when the window is minimised
      backgroundThrottling: false,
      // test mode: render into an offscreen buffer so DevTools screenshots work without a visible window
      offscreen: HIDDEN,
    },
  });
  if (!HIDDEN) win.once("ready-to-show", () => win.show());
  // The web app blocks unload while there are unsaved changes; ask instead of silently refusing.
  win.webContents.on("will-prevent-unload", (event) => {
    const text = t();
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning", title: "CE42 Next", message: text.unsaved, detail: text.unsavedDetail,
      buttons: [text.quit, text.cancel], defaultId: 1, cancelId: 1,
    });
    if (choice === 0) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });
  win.on("closed", () => (win = null));
  void win.loadURL(`${ORIGIN}/index.html`);
}

ipcMain.handle("serial:last-port-name", () => loadSettings().lastPort?.portName || null);
ipcMain.handle("app:set-language", (_event, lang) => {
  if (Object.prototype.hasOwnProperty.call(TEXT, lang)) uiLang = lang;
});

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  protocol.handle(SCHEME, servePage);
  setupSession();
  // Windows/Linux: no menu bar. macOS always shows one, and without it Cmd+C/V/Q do nothing.
  const macMenu = [{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }];
  Menu.setApplicationMenu(process.platform === "darwin" ? Menu.buildFromTemplate(macMenu) : null);
  createWindow();
});

app.on("window-all-closed", () => app.quit());

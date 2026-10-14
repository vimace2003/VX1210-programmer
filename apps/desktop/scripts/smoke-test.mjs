// Smoke test of a packaged build: starts the exe with a hidden window, drives the UI over the
// Chrome DevTools Protocol and reads the simulated radio.
// usage: node scripts/smoke-test.mjs [path-to-executable]   (default: the unpacked build of this platform)
// Linux needs a display: run it under xvfb-run on headless machines.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const release = join(dirname(fileURLToPath(import.meta.url)), "..", "release");
const arm = process.arch === "arm64";
const defaultExe = {
  win32: join(release, "win-unpacked", "CE42 Next.exe"),
  darwin: join(release, arm ? "mac-arm64" : "mac", "CE42 Next.app", "Contents", "MacOS", "CE42 Next"),
  linux: join(release, arm ? "linux-arm64-unpacked" : "linux-unpacked", "ce42-next"),
}[process.platform];
const exe = process.argv[2] ?? defaultExe;
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = { ...process.env, CE42_HIDDEN_WINDOW: "1" };
delete env.ELECTRON_RUN_AS_NODE; // set by VS Code terminals; the packaged app disables it via fuses anyway
// Linux: an unpacked build has no setuid chrome-sandbox and CI runners forbid user namespaces;
// without a desktop session the keyring (D-Bus) can block start-up, so keep cookies in the profile.
const linuxArgs = process.platform === "linux" ? ["--no-sandbox", "--password-store=basic"] : [];
// macOS/Linux: own process group, so the whole app can be killed at the end
const child = spawn(exe, [`--remote-debugging-port=${PORT}`, ...linuxArgs], { env, stdio: "ignore", detached: process.platform !== "win32" });
let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed = true;
};

try {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page" && t.url.startsWith("app://ce42/"));
    } catch {
      /* not up yet */
    }
  }
  if (!target) throw new Error("app window did not appear");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (msg) => (msg.result?.exceptionDetails ? reject(new Error(msg.result.exceptionDetails.text)) : resolve(msg.result?.result?.value)));
    ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  const cdp = (method, params = {}) => new Promise((resolve) => {
    const n = ++id;
    pending.set(n, (msg) => resolve(msg.result));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  // optional screenshots: SMOKE_SCREENS=<dir>
  const shot = async (name) => {
    if (!process.env.SMOKE_SCREENS) return;
    await sleep(300);
    const r = await Promise.race([cdp("Page.captureScreenshot", { format: "png" }), sleep(15000).then(() => null)]);
    if (r?.data) writeFileSync(join(process.env.SMOKE_SCREENS, name + ".png"), Buffer.from(r.data, "base64"));
  };
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const waitFor = async (expression, ms = 30000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await evaluate(expression)) return true;
    return false;
  };

  check("language screen", await waitFor(`document.querySelectorAll(".lang-option").length === 4`),
    await evaluate(`[...document.querySelectorAll(".lang-option")].map((b) => b.textContent).join(", ")`));
  check("logo on language screen", await waitFor(`(() => { const i = document.querySelector(".lang-card img"); return !!i && i.complete && i.naturalWidth === 256; })()`));
  const version = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version;
  const credit = await evaluate(`document.querySelector(".lang-card .byline")?.textContent ?? ""`);
  // the date follows the language: system locale on this screen, Portuguese after choosing "pt"
  const creditPrefix = `By PP5KJ - Ver ${version} - `;
  check("credit on start screen", credit.startsWith(creditPrefix), credit);
  await shot("1-language");
  await evaluate(`document.querySelector('.lang-option[data-lang="pt"]').click(), true`);
  check("logo in header", await waitFor(`(() => { const i = document.querySelector("img.logo"); return !!i && i.complete && i.naturalWidth === 256; })()`));
  check("page rendered", await waitFor(`document.querySelectorAll("table.channels tbody tr").length === 500`));
  const tip = await evaluate(`(async () => {
    const b = document.querySelectorAll("table.channels th .help-btn")[7];
    b.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const t = document.querySelector('[role="tooltip"]');
    const box = t?.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    return t ? { text: t.textContent, visible: box.left >= 0 && box.top >= 0 && box.width > 50 } : null;
  })()`);
  check("help tooltip", !!tip && tip.visible && /20 W/.test(tip.text), tip?.text?.slice(0, 60));
  const modes = await evaluate(`[...document.querySelector("table.channels tbody tr select").options].map((o) => o.textContent).join(" ")`);
  check("ham mode names", modes === "LSB USB CW AM DATA", modes);
  const env = await evaluate(`({ secure: isSecureContext, serial: "serial" in navigator, bridge: !!window.ce42Desktop, title: document.title })`);
  check("secure context", env.secure);
  check("Web Serial available", env.serial);
  check("desktop bridge", env.bridge);
  check("window title", /CE42 Next/.test(env.title), env.title);

  await evaluate(`(() => {
    const s = document.querySelector(".tool-group.radio select");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "demo");
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await evaluate(`document.querySelector(".tool-group.radio button.primary").click(), true`);
  check("read from simulated radio", await waitFor(`!!document.querySelector(".dialog .success")`), await evaluate(`document.querySelector(".dialog p.success, .dialog p.error")?.textContent ?? ""`));
  await evaluate(`document.querySelector(".dialog .actions button").click(), true`);
  const enabled = await evaluate(`document.querySelectorAll("table.channels tbody tr.on").length`);
  check("channels loaded", enabled === 5, `${enabled} enabled`);
  await evaluate(`document.querySelectorAll("table.channels th .help-btn")[3].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })), true`);
  await shot("2-channels");
  await evaluate(`[...document.querySelectorAll(".tabs button")][1].click(), true`);
  await evaluate(`document.querySelectorAll("fieldset.group .help-btn")[5].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })), true`);
  await shot("3-settings");
  await evaluate(`[...document.querySelectorAll(".tabs button")][2].click(), true`);
  await shot("4-selcall");
  const footer = await evaluate(`document.querySelector(".app-footer .byline")?.textContent ?? ""`);
  check("credit in footer", footer.startsWith(creditPrefix), footer);
  await evaluate(`[...document.querySelectorAll(".tabs button")][4].click(), true`);
  const radioTab = await evaluate(`document.querySelector(".info-title .byline")?.textContent ?? ""`);
  check("credit on Radio tab", radioTab === footer, radioTab);
  await shot("5-radio");
  ws.close();
} catch (e) {
  check("smoke test", false, String(e));
} finally {
  // the portable exe is a launcher that starts the real app as a child: kill the whole tree
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("exit", () => child.kill());
  else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
  }
  await sleep(1500);
}
process.exit(failed ? 1 : 0);

// Minimal bridge for the web app (sandboxed, no Node access exposed).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ce42Desktop", {
  isDesktop: true,
  /** Windows name (e.g. "COM3") of the last port chosen in the native port dialog. */
  lastPortName: () => ipcRenderer.invoke("serial:last-port-name"),
  /** Language for the native dialogs ("pt" | "en" | "es" | "ru"). */
  setLanguage: (lang) => ipcRenderer.invoke("app:set-language", String(lang)),
});

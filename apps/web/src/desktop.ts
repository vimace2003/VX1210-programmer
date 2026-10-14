/** Bridge exposed by the Electron shell (apps/desktop/preload.cjs); null in a browser. */
export interface DesktopBridge {
  isDesktop: true;
  lastPortName(): Promise<string | null>;
  /** Language for the shell's native dialogs (port chooser, unsaved changes). */
  setLanguage?(lang: string): Promise<void>;
}

declare global {
  interface Window {
    ce42Desktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== "undefined" ? (window.ce42Desktop ?? null) : null;

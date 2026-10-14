declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

export const APP_VERSION = __APP_VERSION__;
export const BUILD_DATE = new Date(__BUILD_DATE__);
export const AUTHOR = "PP5KJ";

/** "By PP5KJ - Ver 0.3.0 - 14/10/2026" (date in the chosen language's format). */
export function byline(locale: string): string {
  return `By ${AUTHOR} - Ver ${APP_VERSION} - ${BUILD_DATE.toLocaleDateString(locale)}`;
}

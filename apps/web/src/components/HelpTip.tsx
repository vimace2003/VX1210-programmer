import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { HELP, HELP_LABEL, type HelpKey } from "../i18n/help";

const MAX_WIDTH = 320;
const GAP = 8;

/** "?" button; hovering or focusing it shows what the option is for. */
export function HelpTip({ id }: { id: HelpKey }) {
  const { lang } = useI18n();
  const tipId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !button.current || !tip.current) return;
    const b = button.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = b.left + b.width / 2 - t.width / 2;
    left = Math.max(GAP, Math.min(left, vw - t.width - GAP));
    let top = b.bottom + GAP;
    if (top + t.height > vh - GAP) top = Math.max(GAP, b.top - t.height - GAP);
    setPos({ left, top });
  }, [open, lang]);

  const show = () => setOpen(true);
  const hide = () => { setOpen(false); setPos(null); };

  return (
    <>
      <button ref={button} type="button" className="help-btn" aria-label={HELP_LABEL[lang]} aria-describedby={open ? tipId : undefined}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onKeyDown={(e) => e.key === "Escape" && hide()} onClick={(e) => { e.preventDefault(); show(); }}>
        ?
      </button>
      {open && createPortal(
        <div ref={tip} id={tipId} role="tooltip" className="help-tip"
          style={{ maxWidth: MAX_WIDTH, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
          {HELP[lang][id]}
        </div>,
        document.body,
      )}
    </>
  );
}

import { createDefaultImage, type RadioInfo } from "@ce42/core";
import { useCallback, useReducer } from "react";

export interface DocState {
  /** The clone image (.C42 contents). Never mutated in place: every edit makes a copy. */
  bytes: Uint8Array;
  fileName: string | null;
  dirty: boolean;
  rev: number;
  radio: { info: RadioInfo; at: Date } | null;
}

type Action =
  | { type: "load"; bytes: Uint8Array; fileName: string | null; dirty: boolean }
  | { type: "edit"; fn: (draft: Uint8Array) => void }
  | { type: "saved"; fileName: string }
  | { type: "radio"; info: RadioInfo };

function reducer(s: DocState, a: Action): DocState {
  switch (a.type) {
    case "load":
      return { ...s, bytes: a.bytes, fileName: a.fileName, dirty: a.dirty, rev: s.rev + 1 };
    case "edit": {
      const draft = s.bytes.slice();
      a.fn(draft);
      if (draft.every((v, i) => v === s.bytes[i])) return s;
      return { ...s, bytes: draft, dirty: true, rev: s.rev + 1 };
    }
    case "saved":
      return { ...s, fileName: a.fileName, dirty: false };
    case "radio":
      return { ...s, radio: { info: a.info, at: new Date() } };
  }
}

export function useDocument() {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    bytes: createDefaultImage(), fileName: null, dirty: false, rev: 0, radio: null,
  }));
  const edit = useCallback((fn: (draft: Uint8Array) => void) => dispatch({ type: "edit", fn }), []);
  return { state, dispatch, edit };
}

export type Edit = (fn: (draft: Uint8Array) => void) => void;

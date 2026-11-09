// Transient notifications for failed (and a few successful) actions, so errors
// never hide in a paragraph far from the button that caused them.
import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { toastMessages } from "../i18n/auth";
import { useT } from "../i18n/core";

export type ToastKind = "error" | "info" | "success";
type Toast = { id: number; kind: ToastKind; text: string };

type ToastApi = { push: (text: string, kind?: ToastKind) => void };

const ToastContext = createContext<ToastApi>({ push: () => undefined });

const TOAST_MS = 4_500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const t = useT(toastMessages);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((text: string, kind: ToastKind = "error") => {
    const id = nextId.current++;
    setToasts((all) => {
      // the same message twice in a row is one toast, not a stack
      const withoutDupes = all.filter((t) => t.text !== text);
      return [...withoutDupes.slice(-3), { id, kind, text }];
    });
    window.setTimeout(() => dismiss(id), TOAST_MS);
  }, [dismiss]);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button key={toast.id} type="button" className={`toast toast-${toast.kind}`} title={t("dismiss")} onClick={() => dismiss(toast.id)}>
            {toast.text}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

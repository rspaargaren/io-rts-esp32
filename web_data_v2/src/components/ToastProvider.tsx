import { ComponentChildren, createContext } from "preact";
import { useCallback, useState } from "preact/hooks";
import useI18n from "../hooks/useI18n";

export interface Toast {
  id: string;
  message: string;
  type?: ToastType;
  duration?: number;
  isHiding?: boolean;
}

export enum ToastType {
  SUCCESS = "success",
  ERROR = "error",
  INFO = "info",
  DEFAULT = "",
}
export interface ToastContextType {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, duration?: number) => string;
  dismissToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextType | null>(null);

interface ToastProviderProps {
  children?: ComponentChildren;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { t } = useI18n();

  const showToast = useCallback(
    (
      message: string,
      type: ToastType = ToastType.DEFAULT,
      duration: number = 3000,
    ) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      const toast: Toast = { id, message, type, duration };

      setToasts((prev) => [...prev, toast]);

      if (duration > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, duration);
      }

      return id;
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((toast) =>
        toast.id === id ? { ...toast, isHiding: true } : toast,
      ),
    );

    // Remove after animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 300);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <div id="toast-container">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast${toast.type ? ` toast-${toast.type}` : ""}${toast.isHiding ? " toast-hide" : ""}`}
            onClick={() => dismissToast(toast.id)}
          >
            {t(toast.message)}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

import { useContext } from "preact/hooks";
import { ToastContext } from "../components/ToastProvider";

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }

  return context.showToast;
}

import { useEffect, type ReactNode } from "react";

interface ModalProps {
  /** Called when the modal is dismissed (backdrop click or Escape). */
  onClose: () => void;
  children: ReactNode;
}

/** Centered modal dialog over a blurred backdrop. Closes on backdrop click or Escape. */
export function Modal({ onClose, children }: ModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative bg-bg-card rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4"
      >
        {children}
      </div>
    </div>
  );
}

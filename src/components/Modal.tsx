import { useEffect, type ReactNode } from "react";

type ModalActionVariant = "primary" | "secondary" | "danger";

export interface ModalAction {
  label: string;
  onClick: () => void;
  /** Defaults to "primary". */
  variant?: ModalActionVariant;
  disabled?: boolean;
  autoFocus?: boolean;
}

interface ModalProps {
  /** Called when the modal is dismissed (backdrop click or Escape). */
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Action buttons rendered full-width at the bottom, left to right. */
  actions?: ModalAction[];
  /** Optional custom content rendered between the subtitle and the actions. */
  children?: ReactNode;
}

const actionClasses: Record<ModalActionVariant, string> = {
  primary:
    "text-white bg-primary hover:bg-primary-dark disabled:bg-primary/30 disabled:cursor-not-allowed",
  danger: "text-white bg-danger hover:bg-[#d8363c]",
  secondary: "text-text-muted bg-bg hover:text-text",
};

/**
 * Centered modal dialog over a blurred backdrop. Closes on backdrop click or
 * Escape. Layout and styling (title, subtitle, action buttons) are owned by
 * this component so all modals in the app look the same.
 */
export function Modal({ onClose, title, subtitle, actions, children }: ModalProps) {
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
        className="relative bg-bg-card rounded-xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-4"
      >
        <div className="font-bold text-sm text-text">{title}</div>
        {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
        {children}
        {actions && actions.length > 0 && (
          <div className="flex gap-2">
            {actions.map((action) => (
              <button
                key={action.label}
                autoFocus={action.autoFocus}
                disabled={action.disabled}
                onClick={action.onClick}
                className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all active:scale-[0.98] cursor-pointer ${actionClasses[action.variant ?? "primary"]}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

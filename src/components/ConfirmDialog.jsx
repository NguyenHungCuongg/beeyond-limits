import React, { useEffect, useRef } from "react";

export default function ConfirmDialog({
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  focusTriggerRef,
  children,
}) {
  const dialogRef = useRef(null);
  const cancelBtnRef = useRef(null);
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    // Focus the cancel button on mount
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onCancel();
      }

      // Basic focus trap across every button in the dialog
      if (e.key === "Tab") {
        const buttons = dialogRef.current?.querySelectorAll("button") ?? [];
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    const trigger = focusTriggerRef?.current;

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Return focus to trigger when dialog unmounts
      if (trigger) {
        trigger.focus();
      }
    };
  }, [onCancel, focusTriggerRef]);

  return (
    <div className="fixed inset-0 bg-ink/80 z-50 flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-desc"
        className="bg-paper brutal-border brutal-shadow w-full max-w-sm p-6"
      >
        <h2
          id="dialog-title"
          className="font-display text-3xl uppercase mb-3 text-ink leading-none break-words"
        >
          {title}
        </h2>
        <p
          id="dialog-desc"
          className="font-mono text-sm mb-6 text-ink break-words"
        >
          {message}
        </p>
        {children}
        <div className="flex gap-3">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            className="flex-1 bg-paper brutal-border brutal-shadow-sm font-mono font-bold uppercase py-3 hover:bg-canvas transition-colors"
          >
            {cancelText || "Cancel"}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className="flex-1 bg-crimson text-paper brutal-border font-mono font-bold uppercase py-3 hover:bg-ink transition-colors"
          >
            {confirmText || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

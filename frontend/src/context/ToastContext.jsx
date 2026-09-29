/**
 * ToastContext.jsx - Toast notification system for user feedback
 */

import { createContext, useContext, useState, useCallback } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = "info", duration = 3500) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = {
    success: (msg, dur) => showToast(msg, "success", dur),
    error: (msg, dur) => showToast(msg, "error", dur),
    info: (msg, dur) => showToast(msg, "info", dur),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-200 animate-slideUp ${
              t.type === "success"
                ? "bg-white/95 border-emerald-300 text-slate-900"
                : t.type === "error"
                ? "bg-white/95 border-red-300 text-slate-900"
                : "bg-white/95 border-blue-300 text-slate-900"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                  t.type === "success"
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    : t.type === "error"
                    ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                    : "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                }`}
              />
              <p className="text-sm font-medium">{t.message}</p>
            </div>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="text-slate-400 hover:text-slate-700 text-sm shrink-0 p-1"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

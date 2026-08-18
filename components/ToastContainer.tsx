"use client";

import { useEffect, useState } from "react";
import type { Toast } from "@/lib/useToast";

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const getIcon = (type: Toast["type"]) => {
    switch (type) {
      case "success":
        return "✓";
      case "error":
        return "✕";
      case "warning":
        return "⚠";
      case "info":
        return "ℹ";
    }
  };

  const getColors = (type: Toast["type"]) => {
    switch (type) {
      case "success":
        return "bg-emerald-50 border-emerald-200 text-emerald-900";
      case "error":
        return "bg-red-50 border-red-200 text-red-900";
      case "warning":
        return "bg-amber-50 border-amber-200 text-amber-900";
      case "info":
        return "bg-blue-50 border-blue-200 text-blue-900";
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-medium animate-in slide-in-from-bottom-2 fade-in ${getColors(toast.type)}`}
        >
          <span className="text-lg leading-none flex-shrink-0">{getIcon(toast.type)}</span>
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => onRemove(toast.id)}
            className="text-lg leading-none flex-shrink-0 hover:opacity-70"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import type { KeyboardShortcutAction } from "@/lib/keyboard-shortcuts";

export default function KeyboardShortcutsHelp({
  shortcuts,
  isOpen,
  onClose,
}: {
  shortcuts: KeyboardShortcutAction[];
  isOpen: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const navShortcuts = shortcuts.filter((s) => s.group === "navigation");
  const actionShortcuts = shortcuts.filter((s) => s.group === "action");
  const helpShortcuts = shortcuts.filter((s) => s.group === "help");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">⌨️ Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-2xl text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="max-h-96 overflow-y-auto p-6 space-y-6">
          {/* Navigation */}
          {navShortcuts.length > 0 && (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Navigation
              </p>
              <div className="space-y-2">
                {navShortcuts.map((shortcut) => (
                  <div key={shortcut.key} className="flex items-start justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <div>
                      <p className="font-medium text-slate-900">{shortcut.label}</p>
                      <p className="text-xs text-slate-600">{shortcut.description}</p>
                    </div>
                    <kbd className="ml-2 inline-block rounded bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {actionShortcuts.length > 0 && (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Quick Actions
              </p>
              <div className="space-y-2">
                {actionShortcuts.map((shortcut) => (
                  <div key={shortcut.key} className="flex items-start justify-between rounded-lg bg-blue-50 px-3 py-2">
                    <div>
                      <p className="font-medium text-slate-900">{shortcut.label}</p>
                      <p className="text-xs text-slate-600">{shortcut.description}</p>
                    </div>
                    <kbd className="ml-2 inline-block rounded bg-blue-200 px-2 py-1 text-xs font-semibold text-blue-700">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Help */}
          {helpShortcuts.length > 0 && (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">
                Help
              </p>
              <div className="space-y-2">
                {helpShortcuts.map((shortcut) => (
                  <div key={shortcut.key} className="flex items-start justify-between rounded-lg bg-purple-50 px-3 py-2">
                    <div>
                      <p className="font-medium text-slate-900">{shortcut.label}</p>
                      <p className="text-xs text-slate-600">{shortcut.description}</p>
                    </div>
                    <kbd className="ml-2 inline-block rounded bg-purple-200 px-2 py-1 text-xs font-semibold text-purple-700">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 text-center text-xs text-slate-600">
          💡 Press <kbd className="inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold">ESC</kbd> to close
        </div>
      </div>
    </div>
  );
}

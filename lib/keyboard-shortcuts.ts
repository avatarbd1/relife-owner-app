import { useRouter } from "next/navigation";
import { useEffect, useCallback } from "react";

export type KeyboardShortcutAction = {
  key: string;
  label: string;
  description: string;
  action: () => void;
  group: "navigation" | "action" | "help";
};

export function useKeyboardShortcuts(onHelpOpen?: () => void): KeyboardShortcutAction[] {
  const router = useRouter();

  const shortcuts: KeyboardShortcutAction[] = [
    {
      key: "P",
      label: "Payment",
      description: "New payment collection",
      action: () => router.push("/payments"),
      group: "navigation",
    },
    {
      key: "A",
      label: "Appointment",
      description: "View/create appointments",
      action: () => router.push("/appointments"),
      group: "navigation",
    },
    {
      key: "T",
      label: "Treatment",
      description: "Record treatment entry",
      action: () => router.push("/treatment"),
      group: "navigation",
    },
    {
      key: "S",
      label: "Salary",
      description: "Salary payments & settlement",
      action: () => router.push("/salary"),
      group: "navigation",
    },
    {
      key: "E",
      label: "Expenses",
      description: "Manage expense requests",
      action: () => router.push("/expenses"),
      group: "navigation",
    },
    {
      key: "D",
      label: "Dashboard",
      description: "Finance dashboard",
      action: () => router.push("/"),
      group: "navigation",
    },
    {
      key: "?",
      label: "Help",
      description: "Show keyboard shortcuts",
      action: () => onHelpOpen?.(),
      group: "help",
    },
  ];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      const target = event.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      const isModifierKey = event.ctrlKey || event.metaKey || event.altKey;

      // Only trigger for single letter keys without modifiers (except for ?)
      if (isModifierKey && event.key !== "?") return;
      if (isInput) return;

      const upperKey = event.key.toUpperCase();
      const shortcut = shortcuts.find((s) => s.key === upperKey);

      if (shortcut) {
        event.preventDefault();
        shortcut.action();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);

  return shortcuts;
}

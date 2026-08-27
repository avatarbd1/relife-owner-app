import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

export type KeyboardShortcutAction = {
  key: string;
  label: string;
  description: string;
  action: () => void;
  group: "navigation" | "action" | "help";
};

export function useKeyboardShortcuts(onHelpOpen?: () => void): KeyboardShortcutAction[] {
  const router = useRouter();

  const shortcuts = useMemo<KeyboardShortcutAction[]>(
    () => [
      {
        key: "P",
        label: "Payment",
        description: "Open payment collection",
        action: () => router.push("/payments"),
        group: "navigation",
      },
      {
        key: "A",
        label: "Appointments",
        description: "Open appointment workspace",
        action: () => router.push("/appointments"),
        group: "navigation",
      },
      {
        key: "T",
        label: "Treatment / Clinical",
        description: "Open patient files for clinical work",
        action: () => router.push("/patients"),
        group: "navigation",
      },
      {
        key: "S",
        label: "Salary",
        description: "Open salary workspace when authorized",
        action: () => router.push("/salary"),
        group: "navigation",
      },
      {
        key: "E",
        label: "Expenses",
        description: "Open expense workflow when authorized",
        action: () => router.push("/expenses"),
        group: "navigation",
      },
      {
        key: "D",
        label: "Home",
        description: "Open role-aware Home",
        action: () => router.push("/home"),
        group: "navigation",
      },
      {
        key: "?",
        label: "Help",
        description: "Show keyboard shortcuts",
        action: () => onHelpOpen?.(),
        group: "help",
      },
    ],
    [onHelpOpen, router]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
      );
      const isModifierKey = event.ctrlKey || event.metaKey || event.altKey;

      if (isModifierKey && event.key !== "?") return;
      if (isTyping) return;

      const upperKey = event.key.toUpperCase();
      const shortcut = shortcuts.find((item) => item.key === upperKey);
      if (!shortcut) return;

      event.preventDefault();
      shortcut.action();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);

  return shortcuts;
}

"use client";

import { useState, useCallback } from "react";
import KeyboardShortcutsHelp from "@/components/KeyboardShortcutsHelp";
import { useKeyboardShortcuts } from "@/lib/keyboard-shortcuts";

export default function KeyboardShortcutsLayer() {
  const [helpOpen, setHelpOpen] = useState(false);

  const handleHelpOpen = useCallback(() => {
    setHelpOpen(true);
  }, []);

  const shortcuts = useKeyboardShortcuts(handleHelpOpen);

  return (
    <>
      <KeyboardShortcutsHelp
        shortcuts={shortcuts}
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </>
  );
}

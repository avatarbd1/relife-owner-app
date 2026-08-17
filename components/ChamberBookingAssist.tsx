"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { haptic } from "@/lib/interactions";

type DialogState = {
  open: boolean;
  patientId: string;
  genderMissing: boolean;
};

const EMPTY: DialogState = {
  open: false,
  patientId: "",
  genderMissing: false,
};

function patientIdFromInput(value: string): string {
  return value.split("—")[0]?.trim() || "";
}

export default function ChamberBookingAssist() {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(EMPTY);
  const [busy, setBusy] = useState<"Male" | "Female" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    const sync = () => {
      const dialog = document.querySelector<HTMLElement>(
        '#hourly-bed-board [role="dialog"][aria-modal="true"]'
      );
      if (!dialog) {
        document.body.style.overflow = previousOverflow;
        setDialogState((current) => (current.open ? EMPTY : current));
        return;
      }

      document.body.style.overflow = "hidden";
      dialog.style.alignItems = "flex-start";
      dialog.style.paddingTop = "max(env(safe-area-inset-top), 8px)";
      dialog.style.overflowY = "auto";

      const sheet = dialog.firstElementChild as HTMLElement | null;
      if (sheet) {
        sheet.style.maxHeight = "calc(100dvh - 12px)";
        if (sheet.dataset.relifeViewportReady !== "1") {
          sheet.dataset.relifeViewportReady = "1";
          sheet.scrollTop = 0;
        }
      }

      const input = dialog.querySelector<HTMLInputElement>(
        'input[list="chamber-patients"]'
      );
      const patientId = patientIdFromInput(input?.value || "");
      const text = dialog.textContent || "";
      const genderMissing =
        text.includes("Gender missing") ||
        text.toLowerCase().includes("patient gender must be set");

      setDialogState((current) => {
        if (
          current.open &&
          current.patientId === patientId &&
          current.genderMissing === genderMissing
        ) {
          return current;
        }
        return { open: true, patientId, genderMissing };
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.addEventListener("input", sync, true);
    document.addEventListener("change", sync, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("input", sync, true);
      document.removeEventListener("change", sync, true);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function saveGender(gender: "Male" | "Female") {
    if (!dialogState.patientId || busy) return;
    setBusy(gender);
    setMessage("");
    try {
      const response = await fetch(
        `/api/patients/${encodeURIComponent(dialogState.patientId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gender }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "GENDER_UPDATE_FAILED");
      }
      setMessage(`✓ Gender saved: ${gender}`);
      haptic("success");
      router.refresh();
    } catch (error) {
      setMessage(
        `✕ ${error instanceof Error ? error.message : "Gender update failed"}`
      );
      haptic("error");
    } finally {
      setBusy(null);
    }
  }

  if (
    !dialogState.open ||
    !dialogState.patientId ||
    !dialogState.genderMissing
  ) {
    return null;
  }

  return (
    <div
      className="fixed left-3 right-3 z-[95] rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-xl"
      style={{ top: "calc(env(safe-area-inset-top) + 64px)" }}
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-950">Gender required</p>
          <p className="mt-0.5 truncate text-[10px] text-amber-800">
            {dialogState.patientId} · tap once to correct
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void saveGender("Male")}
            className="min-h-10 rounded-lg bg-blue-800 px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy === "Male" ? "Saving…" : "Male"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void saveGender("Female")}
            className="min-h-10 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy === "Female" ? "Saving…" : "Female"}
          </button>
        </div>
      </div>
      {message && (
        <p
          className={`mt-2 text-[10px] font-semibold ${
            message.startsWith("✓") ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}

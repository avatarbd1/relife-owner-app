"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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

function genderFixTarget(dialog: HTMLElement): HTMLElement | null {
  const warning = dialog.querySelector<HTMLElement>(
    '[class*="border-red-200"][class*="bg-red-50"]'
  );
  if (!warning) return null;
  const text = (warning.textContent || "").toLowerCase();
  if (!text.includes("gender")) return null;

  const existing = warning.querySelector<HTMLElement>("[data-relife-gender-fix]");
  if (existing) return existing;

  const target = document.createElement("div");
  target.dataset.relifeGenderFix = "1";
  warning.appendChild(target);
  return target;
}

export default function ChamberBookingAssist() {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>(EMPTY);
  const [target, setTarget] = useState<HTMLElement | null>(null);
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
        setTarget(null);
        setDialogState((current) => (current.open ? EMPTY : current));
        return;
      }

      document.body.style.overflow = "hidden";

      // Mobile booking always occupies the same viewport: below the app header
      // and above bottom navigation. This overrides the legacy bottom-sheet
      // alignment so page scroll position can never decide where the form opens.
      dialog.style.position = "fixed";
      dialog.style.top = "68px";
      dialog.style.right = "0";
      dialog.style.bottom = "72px";
      dialog.style.left = "0";
      dialog.style.height = "auto";
      dialog.style.alignItems = "flex-start";
      dialog.style.justifyContent = "center";
      dialog.style.padding = "0";
      dialog.style.overflow = "hidden";

      const sheet = dialog.firstElementChild as HTMLElement | null;
      if (sheet) {
        sheet.style.width = "100%";
        sheet.style.height = "100%";
        sheet.style.maxHeight = "100%";
        sheet.style.overflowY = "auto";
        sheet.style.borderRadius = "0";
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

      setTarget(genderMissing ? genderFixTarget(dialog) : null);
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
    !target ||
    !dialogState.open ||
    !dialogState.patientId ||
    !dialogState.genderMissing
  ) {
    return null;
  }

  return createPortal(
    <div className="mt-3 border-t border-red-200 pt-3" role="status">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-red-900">Set gender here</p>
          <p className="mt-0.5 truncate text-[10px] text-red-700">
            {dialogState.patientId} · required for shared room safety
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2">
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
    </div>,
    target
  );
}

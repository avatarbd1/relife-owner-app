"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

type StaffPreview = {
  staffId: string;
  fullName: string;
  roles: string[];
  departments: string[];
};

function StaffSetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [supported, setSupported] = useState(true);
  const [staff, setStaff] = useState<StaffPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [alreadyActive, setAlreadyActive] = useState(false);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  async function activate() {
    if (!token || busy || !supported) return;
    setBusy(true);
    setMessage("");
    setAlreadyActive(false);
    try {
      const enrollResponse = await fetch("/api/auth/enroll/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const enrollPayload = await enrollResponse.json().catch(() => ({}));
      if (!enrollResponse.ok || !enrollPayload?.ok) {
        throw new Error(enrollPayload?.error || "Setup link যাচাই করা যায়নি।");
      }
      setStaff(enrollPayload.staff || null);

      const startResponse = await fetch("/api/auth/webauthn/register/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const startPayload = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok || !startPayload?.ok) {
        throw new Error(startPayload?.error || "Passkey setup শুরু করা যায়নি।");
      }

      const credential = await startRegistration({ optionsJSON: startPayload.options });
      const verifyResponse = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credential,
          displayName: "Staff device passkey",
        }),
      });
      const verifyPayload = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verifyPayload?.ok) {
        throw new Error(verifyPayload?.error || "Passkey verify করা যায়নি।");
      }

      setMessage("Device setup complete. এখন Staff login থেকে Fingerprint / Face ID দিয়ে ঢুকুন। Clinic এখনও setup অবস্থায় থাকলে Platform activation-এর পর daily access খুলবে।");
      if (navigator.vibrate) navigator.vibrate(12);
      window.setTimeout(() => {
        router.replace("/login");
        router.refresh();
      }, 900);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const duplicateAuthenticator =
        (error instanceof DOMException && error.name === "InvalidStateError") ||
        /previously registered|already registered|authenticator.*registered/i.test(rawMessage);

      if (duplicateAuthenticator) {
        setAlreadyActive(true);
        setMessage("এই device আগেই activate করা আছে। Setup link আবার লাগবে না—নিচের Staff login চাপুন।");
      } else if (error instanceof DOMException && error.name === "NotAllowedError") {
        setMessage("Device verification বাতিল হয়েছে। আবার চেষ্টা করুন।");
      } else {
        setMessage(rawMessage || "Staff setup ব্যর্থ হয়েছে।");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-5 py-10">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">🔐</div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Relife Staff Access</h1>
          <p className="mt-2 text-sm leading-5 text-slate-500">
            Owner-এর setup link শুধু প্রথমবার এই device activate করার জন্য। এরপর প্রতিদিন normal login page থেকে Fingerprint / Face ID ব্যবহার করবেন।
          </p>
        </div>

        {staff && (
          <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200">
            <p className="font-semibold text-slate-900">{staff.fullName}</p>
            <p className="mt-1">{staff.roles.join(" · ") || "No role"}</p>
            <p className="mt-1 text-xs text-slate-500">{staff.departments.join(" · ")}</p>
          </div>
        )}

        {!token && (
          <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">Setup link পাওয়া যায়নি। প্রথম activation-এর জন্য Owner-এর কাছ থেকে নতুন link নিন। আগে activate করা থাকলে Staff login ব্যবহার করুন।</p>
        )}
        {!supported && (
          <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">এই browser/device WebAuthn support করছে না। Chrome বা supported browser ব্যবহার করুন।</p>
        )}
        {message && (
          <p className={`mt-5 rounded-xl p-3 text-sm ${alreadyActive ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`} role="status">{message}</p>
        )}

        <button
          type="button"
          onClick={activate}
          disabled={!token || !supported || busy}
          className="mt-5 min-h-12 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "Setting up…" : "Activate this device"}
        </button>

        <button
          type="button"
          onClick={() => router.replace("/login")}
          className="mt-3 min-h-12 w-full rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-800 active:bg-slate-200"
        >
          Already activated? Staff login
        </button>

        <p className="mt-4 text-xs leading-5 text-slate-400">
          Setup link one-time/short-lived হতে পারে। Login link আলাদা করে লাগবে না; মূল Relife app খুলে Fingerprint / Face ID চাপলেই হবে। Clinic setup অবস্থায় থাকলে device enrollment করা যাবে, কিন্তু operational workspace Platform activation না হওয়া পর্যন্ত locked থাকবে। Relife biometric image সংরক্ষণ করে না; device/authenticator verification handle করে।
        </p>
      </div>
    </div>
  );
}

export default function StaffSetupPage() {
  return (
    <Suspense fallback={null}>
      <StaffSetupForm />
    </Suspense>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineNotice, Spinner } from "@/components/FeedbackUI";
import TapChoice from "@/components/TapChoice";
import PhotoCaptureRegistration, { type RegistrationExtractedDraft } from "@/components/PhotoCaptureRegistration";
import { haptic } from "@/lib/interactions";

type Department = "Physio" | "Dental";

type Clinician = {
  staffId: string;
  fullName: string;
  department: Department;
};

export default function PatientRegistrationForm({
  allowedDepartments,
  clinicians,
  defaultDepartment,
}: {
  allowedDepartments: Department[];
  clinicians: Clinician[];
  defaultDepartment?: Department;
}) {
  const router = useRouter();
  const [department, setDepartment] = useState<Department>(
    defaultDepartment && allowedDepartments.includes(defaultDepartment)
      ? defaultDepartment
      : allowedDepartments[0] || "Physio"
  );
  const [fullName, setFullName] = useState("");
  const [fatherHusbandName, setFatherHusbandName] = useState("");
  const [phone, setPhone] = useState("");
  const [alternativePhone, setAlternativePhone] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [address, setAddress] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [therapist, setTherapist] = useState("");
  const [referral, setReferral] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [aiDraftApplied, setAiDraftApplied] = useState(false);

  const departmentClinicians = useMemo(
    () => clinicians.filter((item) => item.department === department),
    [clinicians, department]
  );
  const physioGenderRequired = department === "Physio";

  function applyExtractedDraft(draft: RegistrationExtractedDraft) {
    if (draft.fullName) setFullName(draft.fullName);
    if (draft.fatherHusbandName) setFatherHusbandName(draft.fatherHusbandName);
    if (draft.phone) setPhone(draft.phone);
    if (draft.alternativePhone) setAlternativePhone(draft.alternativePhone);
    if (draft.age) setAge(draft.age);
    if (draft.gender) setGender(draft.gender);
    if (draft.address) setAddress(draft.address);
    if (draft.diagnosis) setDiagnosis(draft.diagnosis);
    if (draft.referral) setReferral(draft.referral);
    if (draft.remarks) setRemarks(draft.remarks);
    setAiDraftApplied(true);
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!fullName.trim() || busy) return;
    if (physioGenderRequired && !gender) {
      setError("Physio patient-এর Gender নির্বাচন করুন। Chamber room safety-এর জন্য এটি required।");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/patients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          department,
          fullName,
          fatherHusbandName,
          phone,
          alternativePhone,
          age,
          gender,
          address,
          diagnosis,
          therapist,
          referral,
          remarks,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.error === "DUPLICATE_PHONE") {
          throw new Error(
            `এই ফোনে Active patient আগে থেকেই আছে${result.patientId ? ` (${result.patientId})` : ""}।`
          );
        }
        if (result.error === "INVALID_PATIENT_GENDER") {
          throw new Error("Physio patient-এর Gender নির্বাচন করুন।");
        }
        if (result.error === "ACCESS_DENIED") throw new Error("এই Department-এ patient create permission নেই।");
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      haptic("success");
      router.push(`/patients/${encodeURIComponent(result.patientId)}`);
      router.refresh();
    } catch (submitError) {
      haptic("error");
      setError(submitError instanceof Error ? submitError.message : "Patient registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (allowedDepartments.length === 0) {
    return (
      <p className="rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">
        Patient registration permission নেই।
      </p>
    );
  }

  const inputClass =
    "mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition-colors duration-100 focus:border-blue-700 focus:ring-2 focus:ring-blue-100";

  return (
    <>
      <PhotoCaptureRegistration
        department={department}
        isOpen={showPhotoCapture}
        onClose={() => setShowPhotoCapture(false)}
        onExtract={applyExtractedDraft}
      />

      <form onSubmit={submit} className="space-y-4">
        <section className="rounded-xl border border-blue-100 bg-blue-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-blue-950">Registration entry</p>
              <p className="mt-0.5 text-[11px] leading-5 text-blue-700">Manual entry অথবা prescription/report scan করে AI draft নিন। Final save সবসময় এই form থেকেই হবে।</p>
            </div>
            <button type="button" onClick={() => setShowPhotoCapture(true)} className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-blue-800 ring-1 ring-blue-200">
              📷 Scan
            </button>
          </div>
        </section>

        {aiDraftApplied && (
          <InlineNotice tone="warning" title="AI draft applied — review required">
            Name, phone, age, diagnosisসহ extracted fieldগুলো image থেকে এসেছে। ভুল/অসম্পূর্ণ হলে edit করুন, তারপর Register patient চাপুন।
          </InlineNotice>
        )}

        {allowedDepartments.length > 1 ? (
          <TapChoice
            label="Department"
            value={department}
            options={allowedDepartments.map((item) => ({
              value: item,
              label: item,
              tone: item === "Dental" ? "emerald" : "blue",
            }))}
            onChange={(value) => {
              if (!value) return;
              setDepartment(value as Department);
              setTherapist("");
              setAiDraftApplied(false);
              setError("");
            }}
          />
        ) : (
          <div className={`rounded-lg px-3 py-2.5 text-xs font-semibold ${department === "Dental" ? "bg-emerald-50 text-emerald-800" : "bg-blue-50 text-blue-800"}`}>
            Department · {department}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600">
            Age
            <input value={age} onChange={(event) => setAge(event.target.value)} inputMode="numeric" className={inputClass} />
          </label>
          <div>
            <p className="mb-2 text-xs font-medium text-slate-600">
              Gender {physioGenderRequired ? "*" : "(optional)"}
            </p>
            <TapChoice
              value={gender}
              columns={2}
              allowClear={!physioGenderRequired}
              options={[
                { value: "Male", label: "Male", tone: "blue" },
                { value: "Female", label: "Female", tone: "emerald" },
              ]}
              onChange={(value) => {
                setGender(value);
                setError("");
              }}
            />
            {physioGenderRequired && (
              <p className="mt-1 text-[10px] leading-4 text-slate-400">
                Shared room/bed allocation safety-এর জন্য একবারই লাগবে।
              </p>
            )}
          </div>
        </div>

        <label className="block text-xs font-medium text-slate-600">
          Full name *
          <input required value={fullName} onChange={(event) => setFullName(event.target.value)} className={inputClass} />
        </label>

        <label className="block text-xs font-medium text-slate-600">
          Father / Husband name
          <input value={fatherHusbandName} onChange={(event) => setFatherHusbandName(event.target.value)} className={inputClass} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600">
            Phone {department === "Dental" && <span className="font-normal text-slate-400">(optional)</span>}
            <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" className={inputClass} />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Alternative
            <input value={alternativePhone} onChange={(event) => setAlternativePhone(event.target.value)} inputMode="tel" className={inputClass} />
          </label>
        </div>

        <TapChoice
          label={`${department === "Dental" ? "Dentist" : "Therapist"} · tap to assign`}
          value={therapist}
          allowClear
          columns={departmentClinicians.length >= 3 ? 3 : 2}
          tone={department === "Dental" ? "emerald" : "blue"}
          options={departmentClinicians.map((item) => ({
            value: item.fullName,
            label: item.fullName,
            subtitle: item.staffId,
          }))}
          onChange={setTherapist}
        />
        {departmentClinicians.length === 0 && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">Active clinician option নেই; patient unassigned রাখা যাবে।</p>
        )}

        <label className="block text-xs font-medium text-slate-600">
          Address
          <input value={address} onChange={(event) => setAddress(event.target.value)} className={inputClass} />
        </label>

        <label className="block text-xs font-medium text-slate-600">
          Diagnosis / complaint
          <textarea value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} rows={2} className={inputClass} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-600">
            Referral
            <input value={referral} onChange={(event) => setReferral(event.target.value)} className={inputClass} />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Remarks
            <input value={remarks} onChange={(event) => setRemarks(event.target.value)} className={inputClass} />
          </label>
        </div>

        {error && <p className="relife-error-shake rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={busy || !fullName.trim() || (physioGenderRequired && !gender)}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-800 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-900 disabled:opacity-40"
        >
          {busy && <Spinner size="sm" className="border-white/30 border-t-white" label="Saving patient" />}
          {busy ? "Saving…" : "Register patient"}
        </button>
      </form>
    </>
  );
}

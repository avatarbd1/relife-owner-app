"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

  const departmentClinicians = useMemo(
    () => clinicians.filter((item) => item.department === department),
    [clinicians, department]
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!fullName.trim() || busy) return;
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
        if (result.error === "ACCESS_DENIED") throw new Error("এই Department-এ patient create permission নেই।");
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      router.push(`/patients/${encodeURIComponent(result.patientId)}`);
      router.refresh();
    } catch (submitError) {
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
    "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-slate-600">
          Department
          <select
            value={department}
            onChange={(event) => {
              setDepartment(event.target.value as Department);
              setTherapist("");
            }}
            className={inputClass}
          >
            {allowedDepartments.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Age
          <input value={age} onChange={(event) => setAge(event.target.value)} inputMode="numeric" className={inputClass} />
        </label>
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
          Phone
          <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" className={inputClass} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Alternative
          <input value={alternativePhone} onChange={(event) => setAlternativePhone(event.target.value)} inputMode="tel" className={inputClass} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-slate-600">
          Gender
          <select value={gender} onChange={(event) => setGender(event.target.value)} className={inputClass}>
            <option value="">Select</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Clinician
          <select value={therapist} onChange={(event) => setTherapist(event.target.value)} className={inputClass}>
            <option value="">Unassigned</option>
            {departmentClinicians.map((item) => (
              <option key={item.staffId} value={item.fullName}>{item.fullName}</option>
            ))}
          </select>
        </label>
      </div>

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

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={busy || !fullName.trim()}
        className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Saving..." : "Register patient"}
      </button>
    </form>
  );
}

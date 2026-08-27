import Link from "next/link";

type Appointment = {
  appointmentId: string;
  startMinute: number;
  patientId: string;
  patientName: string;
  therapist: string;
  status: string;
  modalities: string[];
};

type Slot = {
  startMinute: number;
  time: string;
  label: string;
};

type Patient = {
  patientId: string;
  gender: string;
};

function normalizedGender(value: string): "Male" | "Female" | "" {
  const text = String(value || "").trim().toLowerCase();
  if (["male", "m", "পুরুষ", "ছেলে"].includes(text)) return "Male";
  if (["female", "f", "মহিলা", "নারী", "মেয়ে", "মেয়ে"].includes(text)) return "Female";
  return "";
}

function machineLabel(value: string): string {
  const text = String(value || "").toUpperCase();
  if (/TRACTION/.test(text)) return "Traction";
  if (/FACIAL.*TENS/.test(text)) return "Facial TENS";
  if (/TENS/.test(text)) return "TENS";
  if (/IFT/.test(text)) return "IFT";
  if (/EMS/.test(text)) return "EMS";
  if (/UST|ULTRASOUND/.test(text)) return "Ultrasound";
  if (/SWD/.test(text)) return "SWD";
  if (/WAX/.test(text)) return "Wax";
  if (/IRR/.test(text)) return "IRR";
  if (/SHOCKWAVE|SK5/.test(text)) return "Shockwave";
  return value;
}

export default function ChamberCapacityBoard({
  date,
  appointments,
  slots,
  patients,
  canBook,
}: {
  date: string;
  appointments: Appointment[];
  slots: Slot[];
  patients: Patient[];
  canBook: boolean;
}) {
  const genderByPatient = new Map(patients.map((patient) => [patient.patientId, normalizedGender(patient.gender)]));

  return (
    <div className="space-y-2">
      {slots.map((slot) => {
        const hourAppointments = appointments.filter(
          (item) => item.startMinute < slot.startMinute + 60 && item.startMinute + 60 > slot.startMinute
        );
        const male = hourAppointments.filter((item) => genderByPatient.get(item.patientId) === "Male").length;
        const female = hourAppointments.filter((item) => genderByPatient.get(item.patientId) === "Female").length;
        const unknown = hourAppointments.length - male - female;
        const demand = new Map<string, number>();
        for (const appointment of hourAppointments) {
          for (const resource of appointment.modalities) {
            const label = machineLabel(resource);
            demand.set(label, (demand.get(label) || 0) + 1);
          }
        }
        return (
          <section key={slot.time} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-950">{slot.label} · {hourAppointments.length}/4 planned</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">Male {male}</span>
                  <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-bold text-fuchsia-700">Female {female}</span>
                  {unknown ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Gender ? {unknown}</span> : null}
                </div>
              </div>
              {canBook ? (
                <Link
                  href={`/appointments/new?department=Physio`}
                  className="min-h-9 rounded-lg bg-blue-800 px-3 py-2 text-[10px] font-bold text-white"
                >
                  + Book
                </Link>
              ) : null}
            </div>

            {demand.size ? (
              <div className="mt-2 border-t border-slate-100 pt-2">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Expected machine demand · info only</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[...demand.entries()].map(([label, count]) => (
                    <span key={label} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{label} ×{count}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}

      <p className="px-1 pt-1 text-[10px] leading-4 text-slate-400">
        Hard block happens only when gender/room capacity or duplicate-patient conflict is unsafe. Machines never reserve future minutes here.
      </p>
      <p className="px-1 text-[10px] leading-4 text-slate-400">Date: {date} · General treatment planning: 60 ± 5 min.</p>
    </div>
  );
}

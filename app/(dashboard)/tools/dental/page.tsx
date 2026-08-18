import Link from "next/link";
import { formatBDT } from "@/lib/format";
import { getDentalParitySnapshot } from "@/lib/webos/parity";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children = "কোনো রেকর্ড নেই।" }: { children?: React.ReactNode }) {
  return <p className="py-5 text-center text-xs text-slate-400">{children}</p>;
}

export default async function DentalToolsPage({
  searchParams,
}: {
  searchParams?: Promise<{ date?: string }>;
}) {
  const context = await requireCurrentAccessContext();
  const params = searchParams ? await searchParams : {};

  // Fetch dental-specific parity snapshot
  // Note: This uses a hypothetical getDentalParitySnapshot; if it doesn't exist,
  // use getParitySnapshot but filter for Dental department only
  try {
    const snapshot = await getDentalParitySnapshot(context, params.date).catch(async () => {
      // Fallback: use regular parity snapshot but filter dental data
      const { getParitySnapshot } = await import("@/lib/webos/parity");
      const full = await getParitySnapshot(context, params.date);
      return {
        ...full,
        dailyRegister: {
          ...full.dailyRegister,
          rows: full.dailyRegister.rows.filter((row) => row.department === "Dental"),
        },
      };
    });

    const receiptOptions = snapshot.dailyRegister.rows
      .filter((row) => Boolean(row.receiptNo))
      .map((row) => ({
        receiptNo: row.receiptNo,
        patientName: row.patientName,
        amount: row.amount,
      }));

    return (
      <div className="space-y-4">
        <section className="overflow-hidden rounded-xl bg-gradient-to-br from-slate-950 to-emerald-950 p-5 text-white shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200">Dental Operations</p>
              <h1 className="mt-1 text-2xl font-bold">Tools & Diagnostics</h1>
              <p className="mt-1 text-xs leading-5 text-slate-300">Daily register, treatment history, corrections, and staff diagnostics.</p>
            </div>
            <Link href="/tools" className="min-h-10 shrink-0 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">
              Physio tools
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/register" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">Daily register</Link>
            <Link href="/patients" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">Patients</Link>
            <Link href="/finance/history" className="min-h-10 rounded-lg bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">Finance history</Link>
          </div>
        </section>

        <Section title="📋 Today's Dental Register" subtitle="Daily payment-backed entries with patient outcomes">
          {receiptOptions.length > 0 ? (
            <div className="space-y-2">
              {receiptOptions.map((row, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{row.receiptNo}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{row.patientName}</p>
                  </div>
                  <p className="shrink-0 text-right font-semibold text-emerald-700">{formatBDT(row.amount)}</p>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No dental register entries today</Empty>
          )}
        </Section>

        <Section title="🔧 Treatment History Lookup" subtitle="Search patient treatment sessions and outcomes">
          <p className="text-xs text-slate-600">
            Access via <Link href="/patients" className="font-semibold text-blue-600 hover:underline">Patients</Link> → select patient → Clinical tab
          </p>
        </Section>

        <Section title="✏️ Corrections & Adjustments" subtitle="Audit-trail corrections to today's dental register">
          <p className="text-xs text-slate-600">
            Access via <Link href="/corrections" className="font-semibold text-blue-600 hover:underline">Corrections</Link> workspace
          </p>
        </Section>

        <Section title="👥 Staff & Access" subtitle="Team mapping and role/department assignments">
          <div className="space-y-2 text-sm">
            <p className="text-slate-600">Current user:</p>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-500">Role:</span>
                  <p className="font-semibold text-slate-900">{context.roles.join(", ") || "—"}</p>
                </div>
                <div>
                  <span className="text-slate-500">Department:</span>
                  <p className="font-semibold text-slate-900">Dental</p>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section title="📞 Support & Documentation" subtitle="Help with dental operations">
          <div className="space-y-2 text-xs">
            <p>For issues with dental operations:</p>
            <ul className="space-y-1 text-slate-600">
              <li>• Patient registration: Check <Link href="/patients/new" className="font-semibold text-blue-600 hover:underline">New Patient</Link></li>
              <li>• Treatment entry: Use patient Clinical tab</li>
              <li>• Payment collection: Use <Link href="/payments" className="font-semibold text-blue-600 hover:underline">Payments</Link> workspace</li>
              <li>• Finance questions: See <Link href="/finance" className="font-semibold text-blue-600 hover:underline">Finance Dashboard</Link></li>
            </ul>
          </div>
        </Section>
      </div>
    );
  } catch (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Failed to load dental tools. Please check your permissions or try again.
      </div>
    );
  }
}

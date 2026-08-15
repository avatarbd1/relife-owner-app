import Link from "next/link";
import type { WebRole } from "@/lib/webos/access";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";

type MenuItem = { label: string; href: string; note: string };
type MenuSection = { title: string; items: MenuItem[] };

const OWNER: MenuSection[] = [
  {
    title: "Owner · Telegram main menu",
    items: [
      { label: "🏠 হোম", href: "/home", note: "Owner dashboard" },
      { label: "⚖️ ক্যাশ ব্যালেন্স", href: "/finance", note: "Current cash position" },
      { label: "📊 Dashboard", href: "/finance", note: "Physio / Dental / Combined" },
      { label: "💳 পেমেন্ট তথ্য", href: "/operations", note: "Payment collection" },
      { label: "🧾 হিসাব ও খরচ", href: "/operations", note: "Expense · cash · salary actions" },
      { label: "📋 আজকের শিডিউল", href: "/appointments", note: "Today appointments + status" },
      { label: "👤 রোগী ব্যবস্থাপনা", href: "/patients", note: "Register · list · patient file" },
      { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Collision-safe booking" },
      { label: "📝 ট্রিটমেন্ট", href: "/patients", note: "Physio + Dental clinical" },
      { label: "📊 রিপোর্ট ও অ্যানালিটিক্স", href: "/reports", note: "Operational + financial" },
      { label: "🏠 Household Withdrawal", href: "/operations", note: "Separate from clinic expense" },
      { label: "📒 Finance Overview", href: "/finance", note: "Owner finance overview" },
      { label: "📦 ইনভেন্টরি", href: "/tools", note: "Physio inventory + log" },
      { label: "🤖 AI টুলস", href: "/tools", note: "Clinical AI · Staff AI · Case Study" },
      { label: "🗑️ আজকের এন্ট্রি মুছুন", href: "/tools", note: "Guarded correction + audit" },
      { label: "⚙️ সেটিংস", href: "/more", note: "Approvals · passkeys · staff access" },
    ],
  },
  {
    title: "Owner · Telegram submenus",
    items: [
      { label: "🕐 হাজিরা", href: "/daily", note: "Attendance + staff readiness" },
      { label: "📋 আজকের অ্যাপয়েন্টমেন্ট", href: "/appointments", note: "Appointment workflow" },
      { label: "👤 রোগী রেজিস্ট্রেশন", href: "/patients/new", note: "Physio / Dental" },
      { label: "📂 রোগীর ফাইল", href: "/patients", note: "Scoped patient history" },
      { label: "📋 রোগীর তালিকা", href: "/patients", note: "Search + patient actions" },
      { label: "📝 আজকের ট্রিটমেন্ট", href: "/patients", note: "Open clinical file" },
      { label: "📋 এসেসমেন্ট ও প্ল্যান", href: "/patients", note: "Physio assessment + plan" },
      { label: "📜 ট্রিটমেন্ট হিস্ট্রি", href: "/patients", note: "Physio + Dental history" },
      { label: "📋 আজকের রেজিস্টার", href: "/register", note: "Dual-department Daily Register" },
      { label: "🤖 AI প্রশ্ন করুন", href: "/tools", note: "Privacy-minimized Staff AI" },
      { label: "📚 কেস স্টাডি", href: "/tools", note: "Scoped learning" },
      { label: "🩺 ক্লিনিক্যাল অ্যাসিস্ট্যান্ট", href: "/tools", note: "Minimum-necessary clinical context" },
      { label: "💰 স্টাফ বেতন", href: "/operations", note: "PIN-gated salary/advance" },
      { label: "📜 বেতন হিস্টোরি", href: "/finance/history", note: "13_Salary history" },
      { label: "🧾 আমার দেওয়া বেতন", href: "/finance/history", note: "Salary payment records" },
      { label: "🏥 বড় ক্লিনিক খরচ", href: "/operations", note: "Clinic expense request/pay" },
      { label: "📋 খরচ অনুমোদন", href: "/more", note: "Owner approval queue" },
      { label: "💸 ক্লিনিক খরচ হিসাব", href: "/finance/history", note: "Expense tracker" },
      { label: "❌ প্রত্যাখ্যাত খরচ", href: "/finance/history", note: "Rejected expense history" },
      { label: "✅ হ্যান্ডওভার গ্রহণ", href: "/more", note: "Owner cash acceptance" },
      { label: "🔄 ক্যাশ হ্যান্ডওভার হিস্ট্রি", href: "/finance/history", note: "21_Cash_Movement" },
      { label: "🩺 Physio Dashboard", href: "/finance", note: "Choose Physio scope" },
      { label: "🦷 Dental Dashboard", href: "/finance", note: "Choose Dental scope" },
      { label: "🏢 Combined Business Summary", href: "/finance", note: "Choose Combined scope" },
    ],
  },
];

const RECEPTIONIST: MenuSection[] = [
  {
    title: "Receptionist · Telegram menu",
    items: [
      { label: "🏠 হোম", href: "/home", note: "Reception workspace" },
      { label: "👤 রোগী ব্যবস্থাপনা", href: "/patients", note: "Register · list" },
      { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Booking" },
      { label: "📋 আজকের শিডিউল", href: "/appointments", note: "Today + status" },
      { label: "💳 পেমেন্ট তথ্য", href: "/operations", note: "Payment collection" },
      { label: "📊 রিপোর্ট ও অ্যানালিটিক্স", href: "/reports", note: "Operational reports" },
      { label: "🗑️ আজকের এন্ট্রি মুছুন", href: "/tools", note: "Authorized correction" },
      { label: "📦 ইনভেন্টরি", href: "/tools", note: "Authorized stock" },
      { label: "💰 Finance", href: "/operations", note: "Expense + cash workflow" },
      { label: "📋 আজকের রেজিস্টার", href: "/register", note: "Department-safe register" },
    ],
  },
  {
    title: "Receptionist · Finance submenu",
    items: [
      { label: "➕ ছোট খরচের অনুরোধ", href: "/operations", note: "Owner approval required" },
      { label: "✅ অনুমোদিত খরচ পরিশোধ", href: "/operations", note: "Pay approved expense" },
      { label: "💸 ক্লিনিক খরচ হিসাব", href: "/finance/history", note: "Expense tracker" },
      { label: "❌ প্রত্যাখ্যাত খরচ", href: "/finance/history", note: "Rejected requests" },
      { label: "💵 ক্যাশ হ্যান্ডওভার", href: "/operations", note: "Reception → Home Treasury / Bank" },
      { label: "🔄 ক্যাশ হ্যান্ডওভার হিস্ট্রি", href: "/finance/history", note: "Cash movement history" },
      { label: "⚖️ ক্যাশ ব্যালেন্স", href: "/finance/history", note: "Custody movement evidence" },
    ],
  },
];

const THERAPIST: MenuSection[] = [
  {
    title: "Therapist · Telegram menu",
    items: [
      { label: "🏠 হোম", href: "/home", note: "Therapist workspace" },
      { label: "🩺 আজকের রোগী ও সেশন", href: "/patients?view=today", note: "My Today" },
      { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Authorized booking" },
      { label: "📋 রোগীর তালিকা", href: "/patients", note: "Physio scoped" },
      { label: "📝 আজকের ট্রিটমেন্ট", href: "/patients", note: "Patient → Clinical file" },
      { label: "📋 এসেসমেন্ট ও প্ল্যান", href: "/patients", note: "Assessment + treatment plan" },
      { label: "📂 রোগীর ফাইল", href: "/patients", note: "Scoped clinical file" },
      { label: "📜 ট্রিটমেন্ট হিস্ট্রি", href: "/tools", note: "Physio history" },
      { label: "🩺 ক্লিনিক্যাল অ্যাসিস্ট্যান্ট", href: "/tools", note: "Clinical AI" },
      { label: "📚 কেস স্টাডি", href: "/tools", note: "Learning" },
      { label: "📦 ইনভেন্টরি", href: "/tools", note: "Read stock" },
      { label: "🕐 হাজিরা", href: "/daily", note: "Check In · Break · Check Out" },
    ],
  },
];

const MANAGER: MenuSection[] = [
  {
    title: "Manager · Telegram menu",
    items: [
      { label: "🏠 হোম", href: "/home", note: "Manager workspace" },
      { label: "👤 রোগী ব্যবস্থাপনা", href: "/patients", note: "Register · list" },
      { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Booking" },
      { label: "📋 আজকের শিডিউল", href: "/appointments", note: "Today + status" },
      { label: "📝 ট্রিটমেন্ট", href: "/patients", note: "Authorized clinical history" },
      { label: "📊 রিপোর্ট ও অ্যানালিটিক্স", href: "/reports", note: "Operational reports" },
      { label: "🗑️ আজকের এন্ট্রি মুছুন", href: "/tools", note: "Authorized correction" },
      { label: "📦 ইনভেন্টরি", href: "/tools", note: "Stock operations" },
      { label: "💰 Finance", href: "/operations", note: "Expense + cash" },
      { label: "💸 ক্লিনিক খরচ হিসাব", href: "/finance/history", note: "Expense tracker" },
      { label: "❌ প্রত্যাখ্যাত খরচ", href: "/finance/history", note: "Rejected expenses" },
      { label: "✅ হ্যান্ডওভার গ্রহণ", href: "/more", note: "Cash receive / approval" },
      { label: "🔄 ক্যাশ হ্যান্ডওভার হিস্ট্রি", href: "/finance/history", note: "Cash movement history" },
      { label: "⚖️ ক্যাশ ব্যালেন্স", href: "/finance/history", note: "Custody evidence" },
      { label: "📋 আজকের রেজিস্টার", href: "/register", note: "Department-safe register" },
      { label: "🕐 হাজিরা", href: "/daily", note: "Self + team readiness" },
    ],
  },
];

const DENTIST: MenuSection[] = [
  {
    title: "Dentist · Telegram menu",
    items: [
      { label: "🏠 হোম", href: "/home", note: "Dentist workspace" },
      { label: "📋 রোগীর তালিকা", href: "/patients", note: "Dental scoped" },
      { label: "📋 আজকের অ্যাপয়েন্টমেন্ট", href: "/appointments", note: "Dental schedule" },
      { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Authorized booking" },
      { label: "📝 আজকের ট্রিটমেন্ট", href: "/patients", note: "Procedure → Tooth/Area → Note → Status" },
      { label: "📜 ট্রিটমেন্ট হিস্ট্রি", href: "/patients", note: "Dental 05_Treatments" },
      { label: "📂 রোগীর ফাইল", href: "/patients", note: "Dental patient history" },
      { label: "🕐 হাজিরা", href: "/daily", note: "Self attendance" },
    ],
  },
];

const ROLE_SECTIONS: Partial<Record<WebRole, MenuSection[]>> = {
  Owner: OWNER,
  Receptionist: RECEPTIONIST,
  Therapist: THERAPIST,
  Manager: MANAGER,
  Dentist: DENTIST,
  Auditor: [
    {
      title: "Auditor",
      items: [
        { label: "📊 রিপোর্ট ও অ্যানালিটিক্স", href: "/reports", note: "Read-only operational + financial" },
        { label: "📜 Finance history", href: "/finance/history", note: "Expense · cash · salary evidence" },
        { label: "🕐 হাজিরা রিপোর্ট", href: "/daily", note: "Team attendance" },
      ],
    },
  ],
  "System Admin": [
    {
      title: "System Admin",
      items: [
        { label: "⚙️ সেটিংস", href: "/more", note: "System/admin controls only" },
      ],
    },
  ],
};

function temporaryDentalDataEntry(context: {
  roles: WebRole[];
  primaryDepartment: string;
  departmentAccess: string[];
  clinicalWriteScope?: string;
}): boolean {
  return Boolean(
    context.roles.includes("Receptionist") &&
      context.clinicalWriteScope === "Dental_Temporary_Data_Entry" &&
      context.primaryDepartment === "Dental" &&
      context.departmentAccess.length === 1 &&
      context.departmentAccess[0] === "Dental"
  );
}

export default async function MenuPage() {
  const context = await requireCurrentAccessContext();
  const sections: MenuSection[] = [];
  const seen = new Set<string>();

  for (const role of context.roles) {
    for (const section of ROLE_SECTIONS[role] || []) {
      const items = section.items.filter((item) => {
        const key = `${item.label}|${item.href}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (items.length) sections.push({ ...section, items });
    }
  }

  if (temporaryDentalDataEntry(context)) {
    sections.unshift({
      title: "🦷 Temporary Dental Data Entry",
      items: [
        { label: "👤 রোগী রেজিস্ট্রেশন", href: "/patients/new", note: "Dental only" },
        { label: "📋 রোগীর তালিকা", href: "/patients", note: "Dental only" },
        { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Dental only" },
        { label: "📋 আজকের অ্যাপয়েন্টমেন্ট", href: "/appointments", note: "Dental only" },
        { label: "📝 আজকের ট্রিটমেন্ট", href: "/patients", note: "Dental temporary clinical entry" },
        { label: "📜 ট্রিটমেন্ট হিস্ট্রি", href: "/patients", note: "Dental history" },
        { label: "💳 পেমেন্ট তথ্য", href: "/operations", note: "Dental payments" },
        { label: "📊 রিপোর্ট ও অ্যানালিটিক্স", href: "/reports", note: "Dental operational report" },
        { label: "📋 আজকের রেজিস্টার", href: "/register", note: "Dental Daily Register" },
      ],
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Telegram → Web</p>
        <h1 className="mt-1 text-xl font-semibold">Clinic Menu</h1>
        <p className="mt-2 text-xs leading-5 text-slate-300">
          Telegram production menu-এর Web equivalent। Menu visibility security boundary নয়—প্রতিটি data action server-side role + department + live staff policy দিয়ে verify হয়।
        </p>
      </section>

      {sections.map((section, sectionIndex) => (
        <section key={`${section.title}-${sectionIndex}`} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">{section.title}</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {section.items.map((item) => (
              <Link
                key={`${section.title}-${item.label}-${item.href}`}
                href={item.href}
                className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 transition active:scale-[0.99] active:bg-slate-100"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.note}</p>
                </div>
                <span className="shrink-0 text-slate-300">›</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {sections.length === 0 && (
        <section className="rounded-2xl bg-white p-5 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
          এই role-এর production Web menu এখনো provision করা নেই।
        </section>
      )}
    </div>
  );
}

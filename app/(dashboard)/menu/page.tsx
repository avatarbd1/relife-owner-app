import Link from "next/link";
import { requireCurrentAccessContext } from "@/lib/webos/currentUser";
import type { WebRole } from "@/lib/webos/access";

type MenuItem = {
  label: string;
  href: string;
  note: string;
};

type MenuSection = {
  title: string;
  items: MenuItem[];
};

const COMMON: MenuItem[] = [
  { label: "🏠 হোম", href: "/home", note: "Role dashboard" },
  { label: "🕐 হাজিরা", href: "/daily", note: "Check In · Break · Check Out" },
  { label: "📋 আজকের অ্যাপয়েন্টমেন্ট", href: "/appointments", note: "Today schedule" },
];

const ROLE_SECTIONS: Partial<Record<WebRole, MenuSection[]>> = {
  Owner: [
    {
      title: "Owner · Telegram main menu",
      items: [
        { label: "⚖️ ক্যাশ ব্যালেন্স", href: "/operations", note: "Cash custody" },
        { label: "📊 Dashboard", href: "/finance", note: "Physio / Dental finance" },
        { label: "💳 পেমেন্ট তথ্য", href: "/operations", note: "Patient payment" },
        { label: "🧾 হিসাব ও খরচ", href: "/operations", note: "Expense · cash · salary" },
        { label: "📋 আজকের শিডিউল", href: "/appointments", note: "Live appointments" },
        { label: "👤 রোগী ব্যবস্থাপনা", href: "/patients", note: "Register · list · file" },
        { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Collision-safe booking" },
        { label: "📝 ট্রিটমেন্ট", href: "/patients", note: "Open patient clinical file" },
        { label: "📊 রিপোর্ট ও অ্যানালিটিক্স", href: "/reports", note: "Operational + finance" },
        { label: "🏠 Household Withdrawal", href: "/operations", note: "Separate from clinic expense" },
        { label: "📒 Finance Overview", href: "/finance", note: "Owner finance overview" },
        { label: "📦 ইনভেন্টরি", href: "/tools", note: "Physio inventory + log" },
        { label: "🤖 AI টুলস", href: "/tools", note: "Clinical AI · staff AI · case study" },
        { label: "🗑️ আজকের এন্ট্রি মুছুন", href: "/tools", note: "Guarded correction / audit" },
        { label: "⚙️ সেটিংস", href: "/more", note: "Approvals · passkeys · staff access" },
      ],
    },
    {
      title: "Owner · Telegram submenus",
      items: [
        { label: "👤 রোগী রেজিস্ট্রেশন", href: "/patients/new", note: "Physio / Dental" },
        { label: "📂 রোগীর ফাইল", href: "/patients", note: "Scoped patient history" },
        { label: "📋 রোগীর তালিকা", href: "/patients", note: "Search + patient actions" },
        { label: "📝 আজকের ট্রিটমেন্ট", href: "/patients", note: "Physio + Dental clinical" },
        { label: "📋 এসেসমেন্ট ও প্ল্যান", href: "/patients", note: "Physio clinical plan" },
        { label: "📜 ট্রিটমেন্ট হিস্ট্রি", href: "/patients", note: "Per-patient + Tools history" },
        { label: "📋 আজকের রেজিস্টার", href: "/tools", note: "Date-based Daily Register" },
        { label: "🤖 AI প্রশ্ন করুন", href: "/tools", note: "Privacy-minimized staff AI" },
        { label: "📚 কেস স্টাডি", href: "/tools", note: "Scoped case-study lessons" },
        { label: "🩺 ক্লিনিক্যাল অ্যাসিস্ট্যান্ট", href: "/tools", note: "Minimum-necessary context" },
        { label: "💰 স্টাফ বেতন", href: "/operations", note: "PIN-gated salary payment" },
        { label: "📜 বেতন হিস্টোরি", href: "/tools", note: "Salary records" },
        { label: "🏥 বড় ক্লিনিক খরচ", href: "/operations", note: "Clinic expense flow" },
        { label: "📋 খরচ অনুমোদন", href: "/more", note: "Owner approval queue" },
        { label: "💸 ক্লিনিক খরচ হিসাব", href: "/operations", note: "Expense workflow" },
        { label: "❌ প্রত্যাখ্যাত খরচ", href: "/operations", note: "Expense status history" },
        { label: "✅ হ্যান্ডওভার গ্রহণ", href: "/more", note: "Cash acceptance" },
        { label: "🔄 ক্যাশ হ্যান্ডওভার হিস্ট্রি", href: "/operations", note: "Cash movement records" },
        { label: "🩺 Physio Dashboard", href: "/finance", note: "Select Physio scope" },
        { label: "🦷 Dental Dashboard", href: "/finance", note: "Select Dental scope" },
      ],
    },
  ],
  Receptionist: [
    {
      title: "Receptionist · Telegram menu",
      items: [
        { label: "👤 রোগী ব্যবস্থাপনা", href: "/patients", note: "Register · list" },
        { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Booking" },
        { label: "📋 আজকের শিডিউল", href: "/appointments", note: "Today + status" },
        { label: "💳 পেমেন্ট তথ্য", href: "/operations", note: "Payment collection" },
        { label: "📊 রিপোর্ট ও অ্যানালিটিক্স", href: "/reports", note: "Operational report" },
        { label: "🗑️ আজকের এন্ট্রি মুছুন", href: "/tools", note: "Permitted correction" },
        { label: "📦 ইনভেন্টরি", href: "/tools", note: "Authorized stock" },
        { label: "💰 Finance", href: "/operations", note: "Expense · cash custody" },
      ],
    },
    {
      title: "Receptionist · Finance submenus",
      items: [
        { label: "➕ ছোট খরচের অনুরোধ", href: "/operations", note: "Owner approval required" },
        { label: "✅ অনুমোদিত খরচ পরিশোধ", href: "/operations", note: "Pay approved expense" },
        { label: "💸 ক্লিনিক খরচ হিসাব", href: "/operations", note: "Expense status" },
        { label: "❌ প্রত্যাখ্যাত খরচ", href: "/operations", note: "Rejected requests" },
        { label: "💵 ক্যাশ হ্যান্ডওভার", href: "/operations", note: "Reception → treasury" },
        { label: "🔄 ক্যাশ হ্যান্ডওভার হিস্ট্রি", href: "/operations", note: "Movement history" },
        { label: "⚖️ ক্যাশ ব্যালেন্স", href: "/operations", note: "Custody position" },
        { label: "📋 আজকের রেজিস্টার", href: "/tools", note: "Daily register" },
      ],
    },
  ],
  Therapist: [
    {
      title: "Therapist · Telegram menu",
      items: [
        { label: "🩺 আজকের রোগী ও সেশন", href: "/patients?view=today", note: "My Today" },
        { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Authorized booking" },
        { label: "📋 রোগীর তালিকা", href: "/patients", note: "Physio scoped" },
        { label: "📝 আজকের ট্রিটমেন্ট", href: "/patients", note: "Open Clinical file" },
        { label: "📋 এসেসমেন্ট ও প্ল্যান", href: "/patients", note: "Assessment + treatment plan" },
        { label: "📂 রোগীর ফাইল", href: "/patients", note: "Clinical history" },
        { label: "📜 ট্রিটমেন্ট হিস্ট্রি", href: "/tools", note: "Treatment history" },
        { label: "🩺 ক্লিনিক্যাল অ্যাসিস্ট্যান্ট", href: "/tools", note: "Clinical AI" },
        { label: "📚 কেস স্টাডি", href: "/tools", note: "Learning" },
        { label: "📦 ইনভেন্টরি", href: "/tools", note: "Read stock" },
      ],
    },
  ],
  Manager: [
    {
      title: "Manager · Telegram menu",
      items: [
        { label: "👤 রোগী ব্যবস্থাপনা", href: "/patients", note: "Register · list" },
        { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Booking" },
        { label: "📋 আজকের শিডিউল", href: "/appointments", note: "Today + status" },
        { label: "📝 ট্রিটমেন্ট", href: "/patients", note: "Authorized clinical history" },
        { label: "📊 রিপোর্ট ও অ্যানালিটিক্স", href: "/reports", note: "Operational report" },
        { label: "🗑️ আজকের এন্ট্রি মুছুন", href: "/tools", note: "Authorized corrections" },
        { label: "📦 ইনভেন্টরি", href: "/tools", note: "Stock operations" },
        { label: "💰 Finance", href: "/operations", note: "Expense/cash workflow" },
        { label: "💸 ক্লিনিক খরচ হিসাব", href: "/operations", note: "Expense tracker" },
        { label: "❌ প্রত্যাখ্যাত খরচ", href: "/operations", note: "Rejected expenses" },
        { label: "✅ হ্যান্ডওভার গ্রহণ", href: "/more", note: "Authorized cash receive" },
        { label: "🔄 ক্যাশ হ্যান্ডওভার হিস্ট্রি", href: "/operations", note: "Cash history" },
        { label: "⚖️ ক্যাশ ব্যালেন্স", href: "/operations", note: "Custody balance" },
        { label: "📋 আজকের রেজিস্টার", href: "/tools", note: "Daily Register" },
      ],
    },
  ],
  Dentist: [
    {
      title: "Dentist · Telegram menu",
      items: [
        { label: "📋 রোগীর তালিকা", href: "/patients", note: "Dental scoped" },
        { label: "📋 আজকের অ্যাপয়েন্টমেন্ট", href: "/appointments", note: "Dental schedule" },
        { label: "📅 নতুন অ্যাপয়েন্টমেন্ট", href: "/appointments/new", note: "Authorized booking" },
        { label: "📝 আজকের ট্রিটমেন্ট", href: "/patients", note: "Procedure · Tooth/Area · Note · Status" },
        { label: "📜 ট্রিটমেন্ট হিস্ট্রি", href: "/patients", note: "Dental 05_Treatments" },
        { label: "📂 রোগীর ফাইল", href: "/patients", note: "Dental patient history" },
      ],
    },
  ],
  Auditor: [
    {
      title: "Auditor",
      items: [
        { label: "📊 রিপোর্ট ও অ্যানালিটিক্স", href: "/reports", note: "Read-only operational + financial" },
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

function uniqueItems(items: MenuItem[]): MenuItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.label}|${item.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function MenuPage() {
  const context = await requireCurrentAccessContext();
  const sections: MenuSection[] = [];
  const common = uniqueItems(COMMON);
  if (common.length) sections.push({ title: "Daily", items: common });
  for (const role of context.roles) {
    for (const section of ROLE_SECTIONS[role] || []) {
      sections.push({ ...section, items: uniqueItems(section.items) });
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Telegram → Web</p>
        <h1 className="mt-1 text-xl font-semibold">Clinic Menu</h1>
        <p className="mt-2 text-xs leading-5 text-slate-300">
          Telegram-এর production menu-র Web equivalent। Button দেখানো security boundary নয়—প্রতিটি action server-side role + department দিয়ে আবার verify হয়।
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
    </div>
  );
}

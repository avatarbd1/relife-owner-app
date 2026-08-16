export type AppIconName =
  | "home"
  | "finance"
  | "patients"
  | "chamber"
  | "reports"
  | "more"
  | "calendar"
  | "userPlus"
  | "payment"
  | "approval"
  | "attendance"
  | "register"
  | "inventory"
  | "clinical"
  | "staff"
  | "security"
  | "correction"
  | "history"
  | "salary"
  | "expense"
  | "cash";

export default function AppIcon({
  name,
  className = "h-5 w-5",
}: {
  name: AppIconName;
  className?: string;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const paths: Record<AppIconName, React.ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13v-9.5" /><path d="M9.5 20v-5h5v5" /></>,
    finance: <><circle cx="12" cy="12" r="8.5" /><path d="M14.8 8.7c-.7-.6-1.7-.9-2.8-.9-1.6 0-2.8.8-2.8 2s1 1.7 2.9 2.1c2 .4 2.9 1 2.9 2.2 0 1.3-1.2 2.1-3 2.1-1.2 0-2.3-.4-3.1-1.1M12 6.5v11" /></>,
    patients: <><path d="M12 5.2a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z" /><path d="M5.5 20c.7-4 2.9-6.2 6.5-6.2s5.8 2.2 6.5 6.2" /></>,
    chamber: <><path d="M4 7v12M20 7v12M4 14h16" /><path d="M6 10h5v4H6zM13 10h5v4h-5z" /><path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V7" /></>,
    reports: <><path d="M5 20V10" /><path d="M12 20V4" /><path d="M19 20v-7" /><path d="M3 20h18" /></>,
    more: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    calendar: <><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M8 3.5v4M16 3.5v4M4 9.5h16" /></>,
    userPlus: <><circle cx="9" cy="8" r="3" /><path d="M3.8 19c.5-3.4 2.2-5.2 5.2-5.2 1.2 0 2.2.3 3 .9M17 12v6M14 15h6" /></>,
    payment: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 14h4" /></>,
    approval: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    attendance: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    register: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h5" /></>,
    inventory: <><path d="m4 8 8-4 8 4-8 4-8-4Z" /><path d="m4 8v8l8 4 8-4V8M12 12v8" /></>,
    clinical: <><path d="M7 4v6a5 5 0 0 0 10 0V4" /><path d="M5 4h4M15 4h4M12 15v2a3 3 0 0 0 6 0v-1" /><circle cx="18" cy="14" r="1.5" /></>,
    staff: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3.5 19c.5-3.4 2.3-5.2 5.5-5.2s5 1.8 5.5 5.2M15 14.5c2.8.1 4.4 1.6 5 4.5" /></>,
    security: <><path d="M12 3 5.5 5.5v5.2c0 4.1 2.5 7.6 6.5 9.3 4-1.7 6.5-5.2 6.5-9.3V5.5L12 3Z" /><path d="m9 11.5 2 2 4-4" /></>,
    correction: <><path d="M4 7h11a5 5 0 0 1 0 10H9" /><path d="m7 4-3 3 3 3M10 14l-4 4M6 14l4 4" /></>,
    history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5" /><path d="M4 4v4.5h4.5M12 8v4l3 2" /></>,
    salary: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h5M16 13h.01" /></>,
    expense: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    cash: <><path d="M4 7h16v10H4z" /><circle cx="12" cy="12" r="2.5" /><path d="M7 9.5h.01M17 14.5h.01" /></>,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...common}>
      {paths[name]}
    </svg>
  );
}

"use client";

export default function DashboardTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="relife-page-enter">{children}</div>;
}

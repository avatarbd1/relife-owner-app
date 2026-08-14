"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/Card";

export default function MorePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div>
      <Card title="More">
        <p className="mb-4 text-sm text-slate-500">
          Settings, controlled write access (payment/expense approval, cash
          movement) — এগুলো Stage E-তে যোগ হবে। V1 read-only.
        </p>
        <button
          onClick={logout}
          disabled={loading}
          className="w-full rounded-xl bg-slate-900 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Logging out..." : "Log out"}
        </button>
      </Card>
    </div>
  );
}

"use client";

import { useMemo } from "react";

export type PresenceStatus = "online" | "away" | "offline" | "busy";

interface StaffPresence {
  staffId: string;
  name: string;
  lastActive: string;
}

interface StaffPresenceIndicatorProps {
  staff: StaffPresence;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  showLastSeen?: boolean;
}

export default function StaffPresenceIndicator({
  staff,
  size = "md",
  showLabel = true,
  showLastSeen = false,
}: StaffPresenceIndicatorProps) {
  const status = useMemo<PresenceStatus>(() => {
    const lastActiveDate = new Date(staff.lastActive);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastActiveDate.getTime()) / (1000 * 60);

    if (diffMinutes < 5) return "online";
    if (diffMinutes < 30) return "away";
    return "offline";
  }, [staff.lastActive]);

  const statusColor: Record<PresenceStatus, string> = {
    online: "bg-green-500",
    away: "bg-yellow-500",
    offline: "bg-gray-400",
    busy: "bg-red-500",
  };

  const statusEmoji: Record<PresenceStatus, string> = {
    online: "🟢",
    away: "🟡",
    offline: "⚫",
    busy: "🔴",
  };

  const statusLabel: Record<PresenceStatus, string> = {
    online: "Online",
    away: "Away",
    offline: "Offline",
    busy: "Busy",
  };

  const sizeClass: Record<string, string> = {
    sm: "w-2 h-2",
    md: "w-3 h-3",
    lg: "w-4 h-4",
  };

  const lastSeenText = useMemo(() => {
    const lastActiveDate = new Date(staff.lastActive);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastActiveDate.getTime()) / (1000 * 60);

    if (diffMinutes < 1) return "just now";
    if (diffMinutes < 60) return `${Math.floor(diffMinutes)}m ago`;
    const hours = Math.floor(diffMinutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }, [staff.lastActive]);

  return (
    <div className="inline-flex items-center gap-2" title={`Last seen: ${lastSeenText}`}>
      <div className="relative">
        <div className={`${sizeClass[size]} rounded-full ${statusColor[status]}`} />
        <span className="absolute top-0 right-0 text-xs">{statusEmoji[status]}</span>
      </div>
      {showLabel && (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-900">{staff.name}</span>
          <span className="text-xs text-gray-500">{statusLabel[status]}</span>
        </div>
      )}
      {showLastSeen && <span className="text-xs text-gray-500">{lastSeenText}</span>}
    </div>
  );
}

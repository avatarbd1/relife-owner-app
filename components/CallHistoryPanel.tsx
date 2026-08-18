"use client";

import { useMemo } from "react";
import { StatusBadge } from "@/components/FeedbackUI";

type ChatMessage = {
  messageId: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  messageType: "Message" | "System" | "Equipment";
  priority: "Normal" | "Urgent";
  body: string;
  status?: string;
};

interface CallHistoryPanelProps {
  messages: ChatMessage[];
  currentUserId: string;
  onSelectCall?: (messageId: string) => void;
}

export default function CallHistoryPanel({
  messages,
  currentUserId,
  onSelectCall,
}: CallHistoryPanelProps) {
  const callHistory = useMemo(() => {
    return messages
      .filter((msg) => msg.messageType === "System" && msg.body.includes("call"))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);
  }, [messages]);

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    return `${hours}:${minutes} (${day}/${month})`;
  };

  const getPriorityColor = (priority: "Normal" | "Urgent"): string => {
    return priority === "Urgent" ? "text-red-600" : "text-gray-600";
  };

  if (callHistory.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p>No recent calls</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <div className="p-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900">Recent Calls</h3>
      </div>
      <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
        {callHistory.map((call) => (
          <div
            key={call.messageId}
            className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
            onClick={() => onSelectCall?.(call.messageId)}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <p className="font-medium text-gray-900">{call.senderName}</p>
                <p className="text-sm text-gray-500">{call.body}</p>
              </div>
              <StatusBadge
                tone={call.priority === "Urgent" ? "danger" : "info"}
                icon={true}
              >
                {call.priority === "Urgent" ? "Urgent" : "Normal"}
              </StatusBadge>
            </div>
            <p className={`text-xs ${getPriorityColor(call.priority)}`}>
              {formatTime(call.createdAt)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

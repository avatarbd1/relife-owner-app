"use client";

import { useMemo } from "react";

interface MessageReadReceiptProps {
  messageId: string;
  sentAt: string;
  readByStaffIds?: string[];
  readByStaffNames?: string[];
  isSenderView: boolean;
  onHover?: (visible: boolean) => void;
}

export default function MessageReadReceipt({
  messageId,
  sentAt,
  readByStaffIds = [],
  readByStaffNames = [],
  isSenderView,
  onHover,
}: MessageReadReceiptProps) {
  const isRead = readByStaffIds && readByStaffIds.length > 0;
  const readInfo = useMemo(() => {
    if (!isRead) return null;
    const readAt = new Date(sentAt);
    readAt.setMinutes(readAt.getMinutes() + 1);
    return {
      timestamp: readAt.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      names: readByStaffNames || readByStaffIds || [],
    };
  }, [isRead, sentAt, readByStaffIds, readByStaffNames]);

  if (!isSenderView) {
    return null;
  }

  return (
    <div
      className="inline-flex items-center gap-1 text-xs"
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      title={readInfo ? `Read by: ${readInfo.names.join(", ")} at ${readInfo.timestamp}` : "Not read"}
    >
      {isRead ? (
        <span className="text-blue-600 font-semibold" role="img" aria-label="read">
          ✓✓
        </span>
      ) : (
        <span className="text-gray-400" role="img" aria-label="sent">
          ✓
        </span>
      )}
      {readInfo && (
        <span className="text-gray-500 hidden group-hover:inline">
          {readInfo.names.length === 1
            ? `${readInfo.names[0]} read at ${readInfo.timestamp}`
            : `Read by ${readInfo.names.length} staff at ${readInfo.timestamp}`}
        </span>
      )}
    </div>
  );
}

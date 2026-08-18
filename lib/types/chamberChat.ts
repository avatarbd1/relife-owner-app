export type ChamberContextMessagePriority = "Normal" | "Urgent";

export interface ChamberContextMessage {
  messageId: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  senderRoles: string[];
  messageType: "Message" | "System" | "Equipment";
  priority: ChamberContextMessagePriority;
  body: string;
  patientId: string;
  appointmentId: string;
  bedId: string;
  roomId: string;
  equipmentRequestId: string;
  status: string;
}

export interface ChamberChatContext {
  appointmentId: string;
  sessionId: string;
  patientId: string;
  patientName: string;
  therapist: string;
  roomId: string;
  bedId: string;
  time: string;
  status: string;
  active: boolean;
}

export interface ChamberChatRecipient {
  staffId: string;
  fullName: string;
  roles: string[];
}

export interface ChamberChatWorkspacePayload {
  currentStaffId: string;
  contexts: ChamberChatContext[];
  recipients: ChamberChatRecipient[];
  messages: ChamberContextMessage[];
  pendingUrgentCount: number;
}

export type NotificationType =
  | "payment_request_created"
  | "payment_received"
  | "payment_request_expired"
  | "payment_request_cancelled";

export type NotificationRecord = {
  id: string;
  merchantAddress: string;
  type: NotificationType;
  title: string;
  message: string;
  paymentRequestId: string | null;
  paymentRequestReference: string;
  transactionSignature: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

export type NotificationFilter = "all" | "unread" | "read";

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    value === "payment_request_created" ||
    value === "payment_received" ||
    value === "payment_request_expired" ||
    value === "payment_request_cancelled"
  );
}

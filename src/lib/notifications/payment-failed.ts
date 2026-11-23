/**
 * Decides whether a recorded wallet rejection is the genuine transition of a
 * payment request into `failed`.
 *
 * Only the rejection that moves a still-pending request to `failed` may notify
 * the merchant. A rejection on an already-closed request returns
 * `recorded: false` from the RPC and is declined here, so retries, duplicate
 * callbacks, RPC errors and checkout closures never produce a failed-payment
 * notification.
 */
export function shouldNotifyPaymentFailed(input: {
  /** Status read before the rejection was recorded. */
  previousStatus: string | null | undefined;
  /** Status reported by the rejection RPC after it ran. */
  updatedStatus: string | null | undefined;
  /** True only when the RPC actually counted this rejection. */
  rejectionRecorded: boolean;
}): boolean {
  return (
    input.rejectionRecorded === true &&
    input.previousStatus === "pending" &&
    input.updatedStatus === "failed"
  );
}

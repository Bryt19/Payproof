import CheckoutShell from "@/components/checkout/checkout-shell";

export default function LoadingPaymentRequest() {
  return <CheckoutShell request={null} isLoading error={null} />;
}

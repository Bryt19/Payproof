export const MERCHANT_CONSOLE_ROUTES = [
  "/dashboard",
  "/payments",
  "/payment-requests",
  "/invoices",
  "/notifications",
  "/ai-assistant",
  "/settings",
] as const;

export function isMerchantConsolePath(pathname: string): boolean {
  return MERCHANT_CONSOLE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export type RateLimitRule = {
  bucket: string;
  limit: number;
  windowSeconds: number;
};

export const CHALLENGE_IP_RULES: readonly RateLimitRule[] = [
  { bucket: "challenge:ip", limit: 15, windowSeconds: 300 },
  { bucket: "challenge:ip", limit: 60, windowSeconds: 3600 },
];

export const CHALLENGE_UNKNOWN_IP_RULES: readonly RateLimitRule[] = [
  { bucket: "challenge:unknown-ip", limit: 10, windowSeconds: 300 },
  { bucket: "challenge:unknown-ip", limit: 40, windowSeconds: 3600 },
];

export const CHALLENGE_GLOBAL_RULES: readonly RateLimitRule[] = [
  { bucket: "challenge:global", limit: 1000, windowSeconds: 300 },
];

export const CHALLENGE_WALLET_RULES: readonly RateLimitRule[] = [
  { bucket: "challenge:wallet", limit: 5, windowSeconds: 300 },
  { bucket: "challenge:wallet", limit: 15, windowSeconds: 3600 },
];

export const VERIFY_IP_RULES: readonly RateLimitRule[] = [
  { bucket: "verify:ip", limit: 20, windowSeconds: 300 },
];

export const VERIFY_UNKNOWN_IP_RULES: readonly RateLimitRule[] = [
  { bucket: "verify:unknown-ip", limit: 10, windowSeconds: 300 },
];

export const VERIFY_WALLET_RULES: readonly RateLimitRule[] = [
  { bucket: "verify:wallet", limit: 10, windowSeconds: 300 },
];

export const RATE_LIMIT_RETENTION_HOURS = 24;

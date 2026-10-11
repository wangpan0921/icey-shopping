// 极简 API client：从环境变量读 base URL
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
}

export interface Order {
  id: string;
  orderNo: string;
  status: string;
  currency: string;
  amountCents: number;
  items: Array<{ nameSnapshot: string; unitPriceCents: number; quantity: number }>;
  payments?: Array<{ id: string; provider: string; status: string; checkoutUrl: string | null }>;
}

export function formatMoney(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

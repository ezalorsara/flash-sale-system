export type SaleStatus = 'upcoming' | 'active' | 'ended';

export interface SaleStatusResponse {
  productId: string;
  productName: string;
  status: SaleStatus;
  startAt: string;
  endAt: string;
  totalStock: number;
  remaining: number;
  serverTime: string;
}

export type PurchaseOutcome =
  | 'purchased'
  | 'duplicate'
  | 'sold_out'
  | 'not_started'
  | 'ended'
  | 'error'
  | 'invalid_request'
  | 'network_error';

export interface PurchaseResponse {
  outcome: PurchaseOutcome;
  message: string;
}

export interface PurchaseCheckResponse {
  userId: string;
  productId: string;
  purchased: boolean;
  purchasedAt: string | null;
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export async function getSaleStatus(): Promise<SaleStatusResponse> {
  const res = await fetch(`${API_BASE}/api/sale/status`);
  if (!res.ok) throw new Error(`Failed to load sale status (${res.status})`);
  return res.json();
}

export async function purchase(userId: string): Promise<PurchaseResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    return await res.json();
  } catch {
    return { outcome: 'network_error', message: 'Could not reach the server. Check your connection and try again.' };
  }
}

export async function checkPurchase(userId: string): Promise<PurchaseCheckResponse> {
  const res = await fetch(`${API_BASE}/api/purchase/${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`Failed to check purchase status (${res.status})`);
  return res.json();
}

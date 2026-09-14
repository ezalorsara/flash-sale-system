export type SaleStatus = 'upcoming' | 'active' | 'ended';

export interface SaleConfig {
  productId: string;
  productName: string;
  totalStock: number;
  startAt: Date;
  endAt: Date;
}

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
  | 'error';

export interface PurchaseResult {
  outcome: PurchaseOutcome;
  message: string;
}

export interface Order {
  userId: string;
  productId: string;
  createdAt: Date;
}

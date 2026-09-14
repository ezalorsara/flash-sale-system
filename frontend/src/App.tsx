import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkPurchase,
  getSaleStatus,
  purchase,
  type PurchaseOutcome,
  type SaleStatusResponse,
} from './api.js';
import './App.css';

const USER_ID_STORAGE_KEY = 'flash-sale:userId';
const STATUS_POLL_MS = 4000;

type Banner = { kind: 'success' | 'info' | 'warning' | 'error'; text: string };

const OUTCOME_BANNER: Record<PurchaseOutcome, Banner['kind']> = {
  purchased: 'success',
  duplicate: 'info',
  sold_out: 'warning',
  not_started: 'warning',
  ended: 'warning',
  error: 'error',
  invalid_request: 'error',
  network_error: 'error',
};

function readStoredUserId(): string {
  try {
    return localStorage.getItem(USER_ID_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeUserId(userId: string) {
  try {
    localStorage.setItem(USER_ID_STORAGE_KEY, userId);
  } catch {
    // best-effort only; app works fine without persistence
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function App() {
  const [status, setStatus] = useState<SaleStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [userId, setUserId] = useState(readStoredUserId);
  const [alreadyPurchased, setAlreadyPurchased] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const clockOffsetRef = useRef(0);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getSaleStatus();
      setStatus(s);
      setStatusError(null);
      clockOffsetRef.current = new Date(s.serverTime).getTime() - Date.now();
    } catch {
      setStatusError('Could not reach the flash sale server.');
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const stored = readStoredUserId();
    if (!stored) return;
    checkPurchase(stored)
      .then((res) => setAlreadyPurchased(res.purchased))
      .catch(() => {});
  }, []);

  const correctedNow = nowMs + clockOffsetRef.current;

  async function handleBuy(e: React.FormEvent) {
    e.preventDefault();
    const id = userId.trim();
    if (!id) return;

    setSubmitting(true);
    setBanner(null);
    try {
      const res = await purchase(id);
      setBanner({ kind: OUTCOME_BANNER[res.outcome], text: res.message });
      if (res.outcome === 'purchased' || res.outcome === 'duplicate') {
        storeUserId(id);
        setAlreadyPurchased(true);
      }
      await refreshStatus();
    } finally {
      setSubmitting(false);
    }
  }

  const isActive = status?.status === 'active';
  const soldOut = (status?.remaining ?? 1) <= 0;
  const canBuy = isActive && !soldOut && !alreadyPurchased && !submitting && userId.trim().length > 0;

  let countdownLabel: string | null = null;
  if (status?.status === 'upcoming') {
    countdownLabel = `Starts in ${formatDuration(new Date(status.startAt).getTime() - correctedNow)}`;
  } else if (status?.status === 'active') {
    countdownLabel = `Ends in ${formatDuration(new Date(status.endAt).getTime() - correctedNow)}`;
  }

  return (
    <main className="page">
      <div className="card">
        <header className="card-head">
          <p className="eyebrow">Flash sale</p>
          <h1>{status?.productName ?? 'Loading product…'}</h1>
          {status && <StatusBadge status={soldOut && isActive ? 'sold-out' : status.status} />}
        </header>

        {statusError && <p className="status-error">{statusError}</p>}

        {status && (
          <>
            <div className="stock-row">
              <div className="stock-bar" aria-hidden="true">
                <div
                  className="stock-bar-fill"
                  style={{ width: `${(status.remaining / status.totalStock) * 100}%` }}
                />
              </div>
              <span className="stock-label">
                {status.remaining} / {status.totalStock} left
              </span>
            </div>
            {countdownLabel && <p className="countdown">{countdownLabel}</p>}
          </>
        )}

        <form className="buy-form" onSubmit={handleBuy}>
          <label htmlFor="userId">User identifier</label>
          <input
            id="userId"
            name="userId"
            type="text"
            placeholder="e.g. your email"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={alreadyPurchased}
            autoComplete="username"
          />
          <button type="submit" disabled={!canBuy}>
            {submitting ? 'Buying…' : alreadyPurchased ? 'Already purchased' : 'Buy now'}
          </button>
        </form>

        {banner && <div className={`banner banner-${banner.kind}`}>{banner.text}</div>}

        <p className="hint">
          {status?.status === 'upcoming' && 'The buy button unlocks automatically once the sale goes live.'}
          {status?.status === 'active' && !soldOut && 'One item per user. Refreshing won’t give you another shot.'}
          {(soldOut || status?.status === 'ended') && 'This drop is over — better luck on the next one.'}
        </p>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: SaleStatusResponse['status'] | 'sold-out' }) {
  const label = { upcoming: 'Upcoming', active: 'Live now', ended: 'Ended', 'sold-out': 'Sold out' }[status];
  return <span className={`badge badge-${status}`}>{label}</span>;
}

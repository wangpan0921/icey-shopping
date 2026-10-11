'use client';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { API_BASE, formatMoney } from '@/lib/api';

export default function MockPayPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const orderNo = sp.get('orderNo') ?? '';
  const providerRef = sp.get('providerRef') ?? '';
  const amount = Number(sp.get('amount') ?? 0);
  const currency = sp.get('currency') ?? 'usd';
  const [busy, setBusy] = useState(false);

  async function fire(outcome: 'success' | 'failure') {
    setBusy(true);
    try {
      // 调后端 mock webhook（相当于渠道回调）
      const res = await fetch(`${API_BASE}/api/webhooks/mock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerRef, outcome, amountCents: amount, currency }),
      });
      if (!res.ok) throw new Error(`webhook returned ${res.status}`);
      router.push(`/pay/result?orderNo=${encodeURIComponent(orderNo)}`);
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-8">
      <h1 className="text-xl font-semibold">Mock Payment</h1>
      <p className="text-sm text-neutral-600">
        测试环境模拟支付页 (PAYMENT_PROVIDER=mock)。生产走 Stripe 时不会出现这个页面。
      </p>
      <div className="space-y-2 rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Order</span>
          <span className="font-mono">{orderNo}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Amount</span>
          <span>{formatMoney(amount, currency)}</span>
        </div>
      </div>
      <div className="flex gap-3">
        <button
          disabled={busy}
          onClick={() => fire('success')}
          className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          Pay success
        </button>
        <button
          disabled={busy}
          onClick={() => fire('failure')}
          className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          Pay failure
        </button>
      </div>
    </div>
  );
}

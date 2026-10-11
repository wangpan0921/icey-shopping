'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, formatMoney, type Order } from '@/lib/api';

export default function PayResultPage() {
  const sp = useSearchParams();
  const orderNo = sp.get('orderNo');
  const [order, setOrder] = useState<Order | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!orderNo) return;
    let cancelled = false;

    async function pull() {
      try {
        const { data } = await api<{ data: Order }>(`/api/orders/by-no/${orderNo}`);
        if (cancelled) return;
        setOrder(data);
        setTries((t) => t + 1);
        // 终态停止轮询
        const terminal = ['PAID', 'DONE', 'CANCELLED', 'FAILED', 'REFUNDED'];
        if (!terminal.includes(data.status) && tries < 20) {
          setTimeout(pull, 1500);
        }
      } catch (err) {
        console.error(err);
      }
    }
    pull();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNo]);

  if (!orderNo) return <p>Missing orderNo</p>;

  return (
    <div className="mx-auto max-w-md space-y-4 py-8">
      <h1 className="text-xl font-semibold">Payment Result</h1>
      {!order && <p className="text-neutral-600">Checking payment status…</p>}
      {order && (
        <div className="space-y-3 rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-neutral-500">Order</span>
            <span className="font-mono text-sm">{order.orderNo}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-neutral-500">Status</span>
            <StatusBadge status={order.status} />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-neutral-500">Amount</span>
            <span>{formatMoney(order.amountCents, order.currency)}</span>
          </div>
          <ul className="divide-y border-t pt-3 text-sm">
            {order.items.map((i, idx) => (
              <li key={idx} className="flex justify-between py-1">
                <span>{i.nameSnapshot} × {i.quantity}</span>
                <span>{formatMoney(i.unitPriceCents * i.quantity, order.currency)}</span>
              </li>
            ))}
          </ul>
          <a href="/" className="block pt-4 text-sm text-blue-600 hover:underline">
            ← Back to shop
          </a>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'PAID' || status === 'DONE'
      ? 'bg-green-100 text-green-700'
      : status === 'FAILED' || status === 'CANCELLED'
        ? 'bg-red-100 text-red-700'
        : status === 'REFUNDED'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-neutral-100 text-neutral-700';
  return <span className={`rounded px-2 py-0.5 text-xs ${color}`}>{status}</span>;
}

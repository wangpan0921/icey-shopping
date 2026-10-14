'use client';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { API_BASE, formatMoney } from '@/lib/api';

// 支持的 channel 枚举（来自各真实 Adapter 的 mock fallback URL 参数）
type Channel = 'mock' | 'stripe' | 'wechat' | 'alipay';

export default function MockPayPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const orderNo = sp.get('orderNo') ?? '';
  const providerRef = sp.get('providerRef') ?? '';
  const amount = Number(sp.get('amount') ?? 0);
  const currency = sp.get('currency') ?? 'usd';
  // channel 决定调哪个 webhook endpoint；默认 mock（旧 MockAdapter 路径）
  const channel = ((sp.get('channel') as Channel) ?? 'mock') as Channel;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function fire(outcome: 'success' | 'failure') {
    setBusy(true);
    setErr(null);
    try {
      // 根据 channel 构造对应渠道的 webhook payload
      const { endpoint, body, headers } = buildWebhookRequest(channel, {
        providerRef,
        amountCents: amount,
        currency,
        outcome,
      });

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers,
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`webhook ${res.status}: ${text}`);
      }
      router.push(`/pay/result?orderNo=${encodeURIComponent(orderNo)}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-8">
      <h1 className="text-xl font-semibold">Mock Payment · {channel}</h1>
      <p className="text-sm text-neutral-600">
        测试环境模拟支付页（channel={channel}）。开发期零资质跑完整流程用；生产真实渠道配好密钥后不会落到这个页面。
      </p>
      <div className="space-y-2 rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Channel</span>
          <span>{channel}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Order</span>
          <span className="font-mono">{orderNo}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Amount</span>
          <span>{formatMoney(amount, currency)}</span>
        </div>
      </div>
      {err && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}
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

// 根据 channel 构造 webhook 请求（endpoint + body + headers）
// 不同真实渠道的 webhook body 格式差异：
//   - mock/stripe/wechat：JSON body
//   - alipay：form-urlencoded body
function buildWebhookRequest(
  channel: Channel,
  { providerRef, amountCents, currency, outcome }: {
    providerRef: string;
    amountCents: number;
    currency: string;
    outcome: 'success' | 'failure';
  },
) {
  if (channel === 'alipay') {
    const params = new URLSearchParams({
      notify_id: `nt_${Date.now()}`,
      out_trade_no: providerRef,
      trade_status: outcome === 'success' ? 'TRADE_SUCCESS' : 'TRADE_CLOSED',
      total_amount: (amountCents / 100).toFixed(2),
    });
    return {
      endpoint: '/api/webhooks/alipay',
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    };
  }
  if (channel === 'wechat') {
    return {
      endpoint: '/api/webhooks/wechat',
      body: JSON.stringify({
        id: `wh_${Date.now()}`,
        event_type: outcome === 'success' ? 'TRANSACTION.SUCCESS' : 'TRANSACTION.FAIL',
        out_trade_no: providerRef,
        trade_state: outcome === 'success' ? 'SUCCESS' : 'FAIL',
        amount: { total: amountCents },
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  if (channel === 'stripe') {
    return {
      endpoint: '/api/webhooks/stripe',
      body: JSON.stringify({ providerRef, outcome, amountCents, currency }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
  // channel === 'mock'
  return {
    endpoint: '/api/webhooks/mock',
    body: JSON.stringify({ providerRef, outcome, amountCents, currency }),
    headers: { 'Content-Type': 'application/json' },
  };
}

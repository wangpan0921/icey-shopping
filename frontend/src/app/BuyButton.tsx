'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

interface OrderResp {
  data: { id: string; orderNo: string };
}
interface CheckoutResp {
  data:
    | { paymentId: string; provider: string; kind: 'redirect'; url: string; providerRef: string }
    | { paymentId: string; provider: string; kind: string; providerRef: string };
}

// 简单探测当前平台，便于后续扩展小程序/App 时按 platform 走不同调起方式
function detectPlatform(): 'pc_web' | 'mobile_web' {
  if (typeof navigator === 'undefined') return 'pc_web';
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? 'mobile_web'
    : 'pc_web';
}

export default function BuyButton({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    setLoading(true);
    try {
      // 1. 创建订单（当前简化为"立即下单一件"）
      const order = await api<OrderResp>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
      });

      // 2. 创建支付会话
      const checkout = await api<CheckoutResp>('/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.data.id,
          client: { platform: detectPlatform() },
        }),
      });

      // 3. 根据 kind 调起
      if (checkout.data.kind === 'redirect' && 'url' in checkout.data) {
        window.location.href = checkout.data.url;
      } else {
        // 未来扩展: qrcode / jsapi / app_sdk
        alert(`Unsupported checkout kind: ${checkout.data.kind}`);
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? 'Loading…' : 'Buy now'}
    </button>
  );
}

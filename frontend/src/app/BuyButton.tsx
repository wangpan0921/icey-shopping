'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

type Provider = 'stripe' | 'wechat' | 'alipay';

interface OrderResp {
  data: { id: string; orderNo: string };
}
interface CheckoutResp {
  data:
    | { paymentId: string; provider: string; kind: 'redirect'; url: string; providerRef: string }
    | { paymentId: string; provider: string; kind: 'qrcode'; qrCodeUrl: string; providerRef: string }
    | { paymentId: string; provider: string; kind: 'jsapi' | 'app_sdk'; params: Record<string, string>; providerRef: string };
}

// 简单探测当前平台，便于后续扩展小程序/App 时按 platform 走不同调起方式
function detectClient() {
  if (typeof navigator === 'undefined') return { platform: 'pc_web' as const, inWechat: false };
  const ua = navigator.userAgent;
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const inWechat = /MicroMessenger/i.test(ua);
  return {
    platform: (isMobile ? 'mobile_web' : 'pc_web') as 'mobile_web' | 'pc_web',
    inWechat,
    userAgent: ua,
  };
}

export default function BuyButton({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<Provider>('stripe');
  const [qrInfo, setQrInfo] = useState<{ qrCodeUrl: string; orderNo: string } | null>(null);

  const onClick = async () => {
    setLoading(true);
    setQrInfo(null);
    try {
      // 1. 创建订单
      const order = await api<OrderResp>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
      });

      // 2. 创建支付会话
      const checkout = await api<CheckoutResp>('/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.data.id,
          provider,
          client: detectClient(),
        }),
      });

      // 3. 根据 kind 调起
      const d = checkout.data;
      switch (d.kind) {
        case 'redirect':
          window.location.href = d.url;
          break;
        case 'qrcode':
          // 微信 Native 二维码：显示在前端。真正用会用 qrcode.react 之类库画二维码，
          // 这里简单展示字符串 code_url 让你能复制 / 测试，联调时再接入渲染库
          setQrInfo({ qrCodeUrl: d.qrCodeUrl, orderNo: order.data.orderNo });
          break;
        case 'jsapi':
          if (typeof (window as unknown as { WeixinJSBridge?: unknown }).WeixinJSBridge !== 'undefined') {
            // 微信内 JSAPI
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).WeixinJSBridge.invoke('getBrandWCPayRequest', d.params, (res: { err_msg?: string }) => {
              if (res.err_msg === 'get_brand_wcpay_request:ok') {
                window.location.href = `/pay/result?orderNo=${encodeURIComponent(order.data.orderNo)}`;
              } else {
                alert(`支付失败: ${res.err_msg}`);
              }
            });
          } else {
            alert('请在微信内打开本页面');
          }
          break;
        case 'app_sdk':
          alert('App SDK 调起只能在原生 App 中处理，Web 页面不支持。');
          break;
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <select
        value={provider}
        onChange={(e) => setProvider(e.target.value as Provider)}
        disabled={loading}
        className="rounded-lg border bg-white px-2 py-2 text-sm"
      >
        <option value="stripe">Stripe</option>
        <option value="wechat">WeChat</option>
        <option value="alipay">Alipay</option>
      </select>
      <button
        onClick={onClick}
        disabled={loading}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Loading…' : 'Buy now'}
      </button>
      {qrInfo && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/50" onClick={() => setQrInfo(null)}>
          <div className="w-80 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 font-semibold">微信扫码支付</h3>
            <p className="mb-4 text-xs text-neutral-500">订单: {qrInfo.orderNo}</p>
            <code className="block break-all rounded bg-neutral-100 p-3 text-xs">{qrInfo.qrCodeUrl}</code>
            <p className="mt-3 text-xs text-neutral-500">
              code_url 用 QR Code 库渲染成二维码扫码即可。本 demo 只展示原始字符串。
            </p>
            <button
              onClick={() => setQrInfo(null)}
              className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

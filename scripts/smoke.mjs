// 冒烟测试：下单 → 创建支付 → mock webhook → 查订单
// 用法：node scripts/smoke.mjs
const BASE = process.env.BASE_URL ?? 'http://localhost:4000';

async function j(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const assert = (cond, msg) => {
  if (!cond) {
    console.error('ASSERT FAIL:', msg);
    process.exit(1);
  }
};

(async () => {
  console.log('[1] GET /healthz');
  const h = await j('/healthz');
  console.log('   ', h);
  assert(h.ok === true, 'healthz not ok');

  console.log('[2] GET /api/products');
  const products = await j('/api/products');
  assert(products.data.length > 0, 'no products');
  const p = products.data[0];
  console.log('   first:', p.name, p.priceCents);

  console.log('[3] POST /api/orders');
  const orderResp = await j('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: p.id, quantity: 2 }],
      buyerEmail: 'test@example.com',
    }),
  });
  const order = orderResp.data;
  console.log('   orderId=', order.id, 'orderNo=', order.orderNo, 'amount=', order.amountCents);
  assert(order.amountCents === p.priceCents * 2, 'order amount mismatch');
  assert(order.status === 'PENDING', `order status should be PENDING, got ${order.status}`);

  console.log('[4] POST /api/payments/checkout');
  const checkout = await j('/api/payments/checkout', {
    method: 'POST',
    body: JSON.stringify({ orderId: order.id, client: { platform: 'pc_web' } }),
  });
  console.log('   provider=', checkout.data.provider, 'kind=', checkout.data.kind, 'url=', checkout.data.url);
  assert(checkout.data.kind === 'redirect', 'kind should be redirect');
  assert(checkout.data.providerRef, 'providerRef empty');

  console.log('[5] GET /api/orders/:id (should be AWAITING_PAYMENT)');
  const o1 = (await j(`/api/orders/${order.id}`)).data;
  console.log('   status=', o1.status);
  assert(o1.status === 'AWAITING_PAYMENT', 'order should be AWAITING_PAYMENT after checkout');

  console.log('[6] POST /api/webhooks/mock (success)');
  const wh = await j('/api/webhooks/mock', {
    method: 'POST',
    body: JSON.stringify({
      providerRef: checkout.data.providerRef,
      outcome: 'success',
      amountCents: order.amountCents,
      currency: order.currency,
    }),
  });
  console.log('   ', wh);

  console.log('[7] GET /api/orders/:id (should be PAID)');
  const o2 = (await j(`/api/orders/${order.id}`)).data;
  console.log('   status=', o2.status, 'payments=', o2.payments.map((p) => ({ provider: p.provider, status: p.status })));
  assert(o2.status === 'PAID', 'order should be PAID');
  assert(o2.payments.some((p) => p.status === 'SUCCEEDED'), 'payment should be SUCCEEDED');

  console.log('[8] POST /api/webhooks/mock replay (dedup)');
  const wh2 = await j('/api/webhooks/mock', {
    method: 'POST',
    body: JSON.stringify({
      providerRef: checkout.data.providerRef,
      outcome: 'success',
      amountCents: order.amountCents,
      currency: order.currency,
    }),
  });
  console.log('   ', wh2);
  // 新事件 ID 使用了 Date.now(), 所以不会 dedup; 但状态保持 PAID 不回退
  const o3 = (await j(`/api/orders/${order.id}`)).data;
  assert(o3.status === 'PAID', 'order should stay PAID after replay');

  console.log('[9] amount tamper test (expect 400)');
  const bad = await fetch(`${BASE}/api/webhooks/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerRef: checkout.data.providerRef,
      outcome: 'success',
      amountCents: 1, // 篡改
      currency: order.currency,
    }),
  });
  console.log('   status=', bad.status, 'body=', await bad.text());
  assert(bad.status === 400, 'tampered webhook should be 400');

  console.log('\n✅ ALL SMOKE TESTS PASSED');
})().catch((e) => {
  console.error('❌ SMOKE FAILED:', e);
  process.exit(1);
});

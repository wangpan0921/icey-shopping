// 冒烟测试：下单 → 创建支付 → mock webhook → 查订单
// 用法：
//   node scripts/smoke.mjs                    # 默认 provider（取 .env 的 PAYMENT_PROVIDER）
//   PROVIDER=stripe node scripts/smoke.mjs    # 显式指定 provider（但需对应 adapter 处于 mock fallback 或 真实可用）
//   PROVIDER=wechat node scripts/smoke.mjs
//   PROVIDER=alipay node scripts/smoke.mjs
//
// 密钥不全时 wechat/alipay adapter 会走内部 mock fallback，返回假 redirect 到 /pay/mock；
// 本脚本据此在 webhook 阶段向对应 /api/webhooks/<provider> POST 模拟 payload。
const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const PROVIDER = process.env.PROVIDER ?? 'mock';

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

// 根据 provider 生成一个"冒牌" webhook payload，仿照各渠道的格式
function fakeWebhookPayload(provider, { providerRef, amountCents, currency, outcome }) {
  if (provider === 'mock') {
    return { providerRef, outcome, amountCents, currency };
  }
  if (provider === 'wechat') {
    // 简化版（走 wechat adapter 的 mock fallback 分支，不走真实 ciphertext 解密）
    return {
      id: `wh_${Date.now()}`,
      event_type: outcome === 'success' ? 'TRANSACTION.SUCCESS' : 'TRANSACTION.FAIL',
      out_trade_no: providerRef,
      trade_state: outcome === 'success' ? 'SUCCESS' : 'FAIL',
      amount: { total: amountCents },
    };
  }
  if (provider === 'alipay') {
    // 支付宝通知是 form-urlencoded；我们这里用 JSON 发过去但 adapter 会 fallback 读 form
    return {
      formEncoded: new URLSearchParams({
        notify_id: `nt_${Date.now()}`,
        out_trade_no: providerRef,
        trade_status: outcome === 'success' ? 'TRADE_SUCCESS' : 'TRADE_CLOSED',
        total_amount: (amountCents / 100).toFixed(2),
      }).toString(),
    };
  }
  if (provider === 'stripe') {
    // 现在 StripeAdapter 也支持 mock fallback，webhook 读 { providerRef, outcome, ... } 明文
    return { providerRef, outcome, amountCents, currency };
  }
  throw new Error(`Unknown provider: ${provider}`);
}

async function postWebhook(provider, payload) {
  // 支付宝用 form-urlencoded
  if (provider === 'alipay' && payload.formEncoded) {
    const res = await fetch(`${BASE}/api/webhooks/alipay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload.formEncoded,
    });
    return { status: res.status, text: await res.text() };
  }
  const res = await fetch(`${BASE}/api/webhooks/${provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, text: await res.text() };
}

(async () => {
  console.log(`== provider = ${PROVIDER} ==`);

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
    body: JSON.stringify({
      orderId: order.id,
      provider: PROVIDER,
      client: { platform: 'pc_web' },
    }),
  });
  console.log('   provider=', checkout.data.provider, 'kind=', checkout.data.kind);
  assert(checkout.data.providerRef, 'providerRef empty');

  console.log('[5] GET /api/orders/:id (should be AWAITING_PAYMENT)');
  const o1 = (await j(`/api/orders/${order.id}`)).data;
  console.log('   status=', o1.status);
  assert(o1.status === 'AWAITING_PAYMENT', 'order should be AWAITING_PAYMENT after checkout');

  // 对于 wechat/alipay 的 mock fallback，providerRef 在 wechat/alipay adapter 里就是 orderNo
  // 对 mock adapter，providerRef 是 adapter 自己生成的
  const providerRef = checkout.data.providerRef;

  console.log(`[6] POST /api/webhooks/${PROVIDER} (success)`);
  const wh = await postWebhook(
    PROVIDER,
    fakeWebhookPayload(PROVIDER, {
      providerRef,
      amountCents: order.amountCents,
      currency: PROVIDER === 'mock' ? order.currency : (PROVIDER === 'stripe' ? order.currency : 'cny'),
      outcome: 'success',
    }),
  );
  console.log('   ', wh);
  assert(wh.status === 200, `webhook returned ${wh.status}: ${wh.text}`);

  console.log('[7] GET /api/orders/:id (should be PAID)');
  const o2 = (await j(`/api/orders/${order.id}`)).data;
  console.log('   status=', o2.status, 'payments=', o2.payments.map((p) => ({ provider: p.provider, status: p.status })));
  assert(o2.status === 'PAID', `order should be PAID, got ${o2.status}`);
  assert(o2.payments.some((p) => p.status === 'SUCCEEDED'), 'payment should be SUCCEEDED');

  // 幂等 & 金额篡改测试仅对 mock provider 做（其他 provider 的事件 ID 固定/假数据有限）
  if (PROVIDER === 'mock') {
    console.log('[8] POST /api/webhooks/mock replay (dedup)');
    const wh2 = await postWebhook('mock', { providerRef, outcome: 'success', amountCents: order.amountCents, currency: order.currency });
    console.log('   ', wh2);

    console.log('[9] amount tamper test (expect 400)');
    const bad = await fetch(`${BASE}/api/webhooks/mock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerRef, outcome: 'success', amountCents: 1, currency: order.currency }),
    });
    console.log('   status=', bad.status, 'body=', await bad.text());
    assert(bad.status === 400, 'tampered webhook should be 400');
  }

  console.log(`\n✅ smoke passed for provider=${PROVIDER}`);
})().catch((e) => {
  console.error('❌ SMOKE FAILED:', e);
  process.exit(1);
});

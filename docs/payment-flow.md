# 支付流程

## 术语
- **Order**：平台内的订单，服务端一等公民
- **Payment**：订单的一次支付尝试（可能重试、可能换渠道）
- **PaymentEvent**：webhook / 查单归一化后的事件，用于幂等

## 下单 → 支付 → 回调 时序（Stripe Checkout）

```
Browser (PC/Mobile)          Backend                     Stripe
     │                          │                           │
     │ 1. POST /api/orders      │                           │
     │────────────────────────▶ │  create Order(PENDING)    │
     │ ◀───── orderId ───────── │                           │
     │                          │                           │
     │ 2. POST /api/payments/   │                           │
     │    checkout {orderId}    │                           │
     │────────────────────────▶ │                           │
     │                          │ create CheckoutSession    │
     │                          │─────────────────────────▶ │
     │                          │ ◀────── session.url ───── │
     │                          │ create Payment(CREATED)   │
     │                          │ Order→AWAITING_PAYMENT    │
     │ ◀──── {url, kind} ────── │                           │
     │                          │                           │
     │ 3. window.location = url │                           │
     │ ────────────────────────────────────────────────────▶│  (Stripe 托管页, 支持 PC & 手机)
     │                          │                           │
     │                          │                           │ user pays
     │                          │ 4. POST /api/webhooks/    │
     │                          │   stripe (验签, raw body) │◀─────┐
     │                          │ ◀──────────────────────── │      │
     │                          │ dedup via PaymentEvent    │      │ 异步事件
     │                          │ 验金额/币种               │      │ Stripe 重试
     │                          │ Payment→SUCCEEDED         │      │ 直到 2xx
     │                          │ Order→PAID                │──────┘
     │                          │                           │
     │ 5. redirect success_url  │                           │
     │ ◀───────────────────────────────────────────────────│
     │ 6. GET /api/orders/by-no/..  (轮询) │                │
     │────────────────────────▶ │                           │
     │ ◀───── {status: PAID} ── │                           │
```

关键注意：
1. **浏览器拿到的 success/cancel 回跳 URL 只用来展示**，订单最终状态永远只信 webhook / 主动查单。
2. Webhook 必须 2xx，Stripe 才停止重试。失败 Stripe 最长重试 3 天。
3. 幂等：`(provider, eventId)` 唯一键 + Prisma 捕获 P2002 Unique 错误直接返回 200。
4. 金额/币种校验：webhook 事件里携带的金额必须等于我们的 Payment.amountCents，否则拒绝入账。

## 退款

调用 `provider.refund({ providerRef, amountCents })`，Stripe 处理完后会发 `charge.refunded` 事件；
webhook 收到后把 Order 置为 `REFUNDED`。

## 扩展：微信支付（示意）

- 浏览器中打开（**非微信内**）→ WeChat Pay H5 支付 → 返回 `mweb_url` 跳转
- 微信内 H5 → JSAPI，需要 openid，`WechatAdapter.createPayment` 返回 `kind: 'jsapi'` + params
- PC 结账 → Native 支付，返回 `kind: 'qrcode'`
- 小程序 → `kind: 'jsapi'` + 小程序专用 appid
- Android App → `kind: 'app_sdk'`

无论哪种，webhook 入口都走同一套幂等/状态机，差异只在 adapter 内部。

## 扩展：支付宝

- PC → `alipay.trade.page.pay` → `kind: 'redirect'`（页面跳转）
- 手机 H5 → `alipay.trade.wap.pay` → `kind: 'redirect'`
- App → `alipay.trade.app.pay` → `kind: 'app_sdk'`
- 小程序 → `alipay.trade.create` + 小程序 SDK → `kind: 'jsapi'`

需要注意既往已验证的坑：
- 加签参数要含 `sign_type`
- 时间戳必须用北京时间 (GMT+8)
- 沙箱/正式密钥与网关要成对配置
- 私钥只放服务端

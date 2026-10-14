# 支付流程

## 术语
- **Order**：平台内的订单，服务端一等公民
- **Payment**：订单的一次支付尝试（可能重试、可能换渠道）
- **PaymentEvent**：webhook / 查单归一化后的事件，用于幂等

## 通用时序（下单 → 支付 → 回调）

```
Browser (PC/Mobile)          Backend                     Provider
     │                          │                           │
     │ 1. POST /api/orders      │                           │
     │────────────────────────▶ │  create Order(PENDING)    │
     │ ◀───── orderId ───────── │                           │
     │                          │                           │
     │ 2. POST /api/payments/   │                           │
     │    checkout {orderId,    │                           │
     │     provider,client}     │                           │
     │────────────────────────▶ │                           │
     │                          │ provider.createPayment()  │
     │                          │─────────────────────────▶ │
     │                          │ ◀── url/qrcode/jsapi ─── │
     │                          │ Payment(CREATED)          │
     │                          │ Order→AWAITING_PAYMENT    │
     │ ◀────── {kind, ...} ──── │                           │
     │                          │                           │
     │ 3. 根据 kind 调起支付     │                           │
     │    (redirect / qrcode    │                           │
     │     / jsapi / app_sdk)   │                           │
     │ ────────────────────────────────────────────────────▶│  用户支付
     │                          │                           │
     │                          │ 4. POST /api/webhooks/*   │◀───┐
     │                          │   验签 + 幂等 + 核对金额   │    │ 异步事件
     │                          │ ◀──────────────────────── │    │ Provider 重试
     │                          │ Payment→SUCCEEDED         │    │ 直到 2xx
     │                          │ Order→PAID                │────┘
     │                          │                           │
     │ 5. 跳回 success_url      │                           │
     │ ◀────────────────────────────────────────────────── │
     │ 6. GET /api/orders/..    │                           │
     │ ◀───── {status: PAID} ── │                           │
```

**铁律**：
1. 浏览器拿到的 success/cancel 回跳 URL 只用来展示，订单最终状态永远只信 webhook / 主动查单。
2. Webhook 必须 2xx，Provider 才停止重试。
3. 幂等：`(provider, eventId)` 唯一键 + Prisma 捕获 P2002 Unique 错误直接返回 2xx。
4. 金额/币种校验：webhook 事件里携带的金额必须等于我们的 Payment.amountCents，否则拒绝入账。

## 调起方式分发（adapter 内部）

| 渠道   | PC                          | Mobile 浏览器            | 微信内              | App                       |
|--------|-----------------------------|-------------------------|---------------------|---------------------------|
| Stripe | Checkout Session (redirect) | 同左（自适应托管页）     | 同左                | 用 Stripe iOS/Android SDK |
| 微信   | Native (qrcode: code_url)   | H5 (redirect: mweb_url) | JSAPI (params)      | App 支付 (params)         |
| 支付宝 | PC Page (redirect)          | WAP (redirect)          | WAP 或小程序 JSAPI  | App 支付 (app_sdk params) |

`PaymentProvider.createPayment()` 返回的 `kind` 字段告诉前端如何调起：
- `redirect` → `window.location.href = url`
- `qrcode` → 用 QR Code 库渲染 `qrCodeUrl` 让用户扫
- `jsapi` → `WeixinJSBridge.invoke('getBrandWCPayRequest', params, ...)`（必须在微信内）
- `app_sdk` → 原生 App 收到 params 后调用对应 SDK

## 验签要点（adapter.verifyAndParseWebhook）

| 渠道   | 签名机制                                       | Body 格式                 | 响应要求                               |
|--------|------------------------------------------------|---------------------------|----------------------------------------|
| Stripe | HMAC-SHA256 (`stripe-signature` header + webhook secret) | JSON                | 任何 2xx                               |
| 微信   | RSA-SHA256 (`wechatpay-signature` header + 平台证书) | JSON + ciphertext (AES-GCM) | `{code:"SUCCESS", message:"成功"}` 2xx |
| 支付宝 | RSA2 (`sign` 字段，支付宝公钥验签)             | application/x-www-form-urlencoded | 明文 `"success"` 2xx                   |

**raw body 保留**：所有渠道都要用 `express.raw({ type: '*/*' })` 在 json 中间件之前挂载，才能正确做 HMAC / RSA 验签。

## 退款

调用 `provider.refund({ providerRef, amountCents })`，Provider 处理完后会发对应的退款事件：
- Stripe → `charge.refunded`
- 微信 → `REFUND.SUCCESS`
- 支付宝 → 退款单独走 `alipay.trade.refund` 查询，或退款回调

Webhook 收到后把 Order 置为 `REFUNDED`。

## 开发期零资质跑通

每个真实渠道（stripe/wechat/alipay）的 Adapter 都内置 "mock fallback"：
- 构造时检查对应密钥是否齐全；不齐 → 走 mock 分支，`createPayment` 返回假 redirect 跳 `/pay/mock`，用户点击 "Pay success" 就模拟真实回调。
- 这样 `PAYMENT_PROVIDER=wechat` 不配密钥也能在前端走完整条流程，等拿到商户号把密钥填进 `.env`、重启进程，不改代码即可切到真实渠道。

真实联调时 webhook 必须公网可达：
- Stripe：`stripe listen --forward-to localhost:4000/api/webhooks/stripe`（本地转发）
- 微信/支付宝：内网穿透（ngrok / cloudflared / frp）把 `/api/webhooks/wechat` 和 `/api/webhooks/alipay` 暴露公网，然后在商户后台填回调地址。

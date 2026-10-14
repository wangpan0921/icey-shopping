# icey-shopping

一个面向境外买家的购物网站骨架，H5 支付以 Stripe 为主渠道，预留微信/支付宝/其他渠道的扩展位，后端 API 可被 Web / 微信小程序 / Android App 共用。

## 架构

```
┌──────────────────────────────────────────────────────────┐
│  frontend (Next.js 14, 响应式, PC + Mobile 一套代码)      │
└───────────────┬──────────────────────────────────────────┘
                │ REST (JSON)
┌───────────────▼──────────────────────────────────────────┐
│  backend (Node + TypeScript + Express + Prisma)          │
│                                                          │
│  ┌────────────┐   ┌────────────────────────────────────┐ │
│  │ Orders     │──▶│  PaymentProvider (适配层)          │ │
│  │ Products   │   │   ├─ StripeAdapter  (境外, 已实现) │ │
│  │ Webhooks   │   │   ├─ WechatAdapter  (境内, 已实现) │ │
│  └────────────┘   │   ├─ AlipayAdapter  (境内, 已实现) │ │
│                   │   └─ MockAdapter    (测试/CI)      │ │
│                   └────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
                │
                ▼ Prisma
          SQLite (dev) / PostgreSQL (prod)
```

关键设计：
- 订单状态**以 webhook / 主动查单为准，不信任前端跳回参数**。
- Webhook 必须**验签 + 幂等**（`PaymentEvent` 表按事件 ID 去重）。
- 所有密钥仅在后端 `.env`，前端只有 Publishable key。
- 一个 `PaymentProvider` 抽象，新增渠道 = 新增一个 adapter 文件，主流程不动。

## 快速开始

目前已实现三个支付渠道，用 `backend/.env` 的 `PAYMENT_PROVIDER` 切换：

| 模式          | 用途               | 需要资质 | 需要密钥                                       |
|---------------|--------------------|---------|-----------------------------------------------|
| mock          | 本地跑通、单测、CI | 否      | 无                                            |
| stripe        | 境外买家（美元等） | 测试否生产是 | Stripe secret + webhook secret           |
| wechat        | 境内微信支付       | 测试否生产是 | WECHAT_APPID/MCHID/API_V3_KEY/PRIVATE_KEY/SERIAL_NO |
| alipay        | 境内支付宝         | 测试否生产是 | ALIPAY_APP_ID/PRIVATE_KEY/PUBLIC_KEY     |

**关键机制：开发期零资质跑通**
每个真实渠道的 Adapter 都内置 mock fallback，密钥不填就自动走假流程（返回假 redirect 跳 `/pay/mock`），拿到商户号把密钥填进 `.env` 重启即可切真实渠道，不改代码。

### 后端
```bash
cd backend
cp .env.example .env       # 默认 PAYMENT_PROVIDER=mock, 不需要任何密钥
npm install
npm run db:push            # 建 SQLite + 建表
npm run db:seed            # 塞几条邦尼包商品示例数据
npm run dev                # http://localhost:4000
```

切到 Stripe 测试：编辑 `.env`，`PAYMENT_PROVIDER=stripe`、填 Stripe 测试密钥（`sk_test_...` / `whsec_...`），重启。

### 前端
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev                # http://localhost:3000
```

### Webhook 本地联调（Stripe CLI）
```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
# 把输出的 whsec_xxx 填回 backend/.env 的 STRIPE_WEBHOOK_SECRET
```

### 局域网访问（手机 / 其他电脑访问同一个开发实例）

一台机器跑完整栈，其他设备（手机 / Windows / Mac）只做浏览器访问时：

1. 查后端机的局域网 IP（Linux: `ip -4 addr | grep inet`，macOS: `ipconfig getifaddr en0`，Windows: `ipconfig`）。假设是 `192.168.1.100`。
2. 编辑 `backend/.env`：
   ```ini
   PUBLIC_WEB_URL=http://192.168.1.100:3000
   PUBLIC_API_URL=http://192.168.1.100:4000
   CORS_ORIGINS=http://192.168.1.100:3000,http://localhost:3000
   ```
3. 编辑 `frontend/.env.local`：
   ```ini
   NEXT_PUBLIC_API_URL=http://192.168.1.100:4000
   ```
4. 启动前端用 `npm run dev:lan`（而不是 `npm run dev`）—— 这会让 Next 监听 `0.0.0.0` 而非仅 `localhost`。后端 Express 默认已经监听 `0.0.0.0`。
5. 放行防火墙 3000/4000 端口。Linux ufw: `sudo ufw allow 3000/tcp && sudo ufw allow 4000/tcp`。
6. 从其他设备访问 `http://192.168.1.100:3000`。

改完 `.env` 必须重启进程（Node 不热加载环境变量）。

## 测试环境 vs 生产环境

通过环境变量切换，不需要代码分支：

| 变量                    | development          | production           |
|-------------------------|----------------------|----------------------|
| `NODE_ENV`              | `development`        | `production`         |
| `PAYMENT_PROVIDER`      | `mock` or `stripe`   | `stripe`             |
| `STRIPE_SECRET_KEY`     | `sk_test_...`        | `sk_live_...`        |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...`(测试)    | `whsec_...`(生产)    |
| `DATABASE_URL`          | `file:./dev.db`      | `postgresql://...`   |

## 扩展指引

- 新支付渠道（微信/支付宝）：在 `backend/src/payments/providers/` 加 `WechatAdapter.ts`，实现 `PaymentProvider` 接口，然后在 `registry.ts` 注册即可。接口 I/O 已经抽象到和具体渠道无关。
- 微信小程序 / Android App：直接消费 `/api/*` REST 接口；小程序走 JSAPI、App 走 SDK 调起时，`PaymentProvider.createPayment()` 返回的 payload 结构已经为"渠道差异"预留了 `extra` 字段。

## 目录结构

```
icey-shopping/
├── backend/
│   ├── src/
│   │   ├── config/        # 环境变量读取 + 校验
│   │   ├── common/        # 中间件、日志、错误、工具
│   │   ├── products/      # 商品
│   │   ├── orders/        # 订单领域 + 状态机
│   │   ├── payments/      # 支付适配层
│   │   │   ├── types.ts
│   │   │   ├── PaymentProvider.ts
│   │   │   ├── registry.ts
│   │   │   └── providers/
│   │   │       ├── StripeAdapter.ts
│   │   │       └── MockAdapter.ts
│   │   ├── webhooks/      # Stripe/未来其他渠道 webhook
│   │   ├── db/            # Prisma client
│   │   ├── app.ts         # Express app 装配
│   │   └── server.ts      # 启动入口
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.ts
│   └── .env.example
├── frontend/              # Next.js 14 响应式 Web
└── docs/
    └── payment-flow.md    # 下单 / 支付 / 回调 时序图
```

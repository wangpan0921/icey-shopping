// 统一环境变量读取 + 校验
// 优点：启动时 fail-fast，避免生产环境漏配密钥到跑时才炸
// 任何渠道（stripe/wechat/alipay）在密钥为空时都允许启动，走 adapter 内部的 mock fallback，
// 这样零资质环境也能跑完整条前端流程；真实联调前再把对应密钥补齐即可。
import 'dotenv/config';
import { z } from 'zod';

const providerSchema = z.enum(['mock', 'stripe', 'wechat', 'alipay']);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1).default('file:./dev.db'),

  PAYMENT_PROVIDER: providerSchema.default('mock'),

  // ===== Stripe =====
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_CURRENCY: z.string().default('usd'),

  // ===== 微信支付 v3 =====
  // 商户号、应用号、API v3 密钥、商户私钥、商户证书序列号
  // 密钥都为空时 WechatAdapter 自动走 mock fallback
  WECHAT_APPID: z.string().optional().default(''),
  WECHAT_MCHID: z.string().optional().default(''),
  WECHAT_API_V3_KEY: z.string().optional().default(''),
  WECHAT_PRIVATE_KEY: z.string().optional().default(''),      // -----BEGIN PRIVATE KEY----- ... 整段，\n 要还原
  WECHAT_SERIAL_NO: z.string().optional().default(''),         // 商户证书序列号

  // ===== 支付宝 =====
  // 应用 ID、应用私钥、支付宝公钥、网关（沙箱切 openapi.alipaydev.com）
  ALIPAY_APP_ID: z.string().optional().default(''),
  ALIPAY_PRIVATE_KEY: z.string().optional().default(''),       // 应用私钥，不含 BEGIN/END 头尾也可
  ALIPAY_PUBLIC_KEY: z.string().optional().default(''),        // 支付宝公钥，用于验签回调
  ALIPAY_GATEWAY: z.string().url().default('https://openapi.alipay.com/gateway.do'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
}).superRefine((v, ctx) => {
  // 生产环境下，选到真实渠道必须有完整密钥
  if (v.NODE_ENV !== 'production') return;

  if (v.PAYMENT_PROVIDER === 'stripe') {
    if (!v.STRIPE_SECRET_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_SECRET_KEY'], message: 'required in production when PAYMENT_PROVIDER=stripe' });
    }
    if (!v.STRIPE_WEBHOOK_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_WEBHOOK_SECRET'], message: 'required in production' });
    }
  }
  if (v.PAYMENT_PROVIDER === 'wechat') {
    for (const k of ['WECHAT_APPID', 'WECHAT_MCHID', 'WECHAT_API_V3_KEY', 'WECHAT_PRIVATE_KEY', 'WECHAT_SERIAL_NO'] as const) {
      if (!v[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `required in production when PAYMENT_PROVIDER=wechat` });
    }
  }
  if (v.PAYMENT_PROVIDER === 'alipay') {
    for (const k of ['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY'] as const) {
      if (!v[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `required in production when PAYMENT_PROVIDER=alipay` });
    }
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[config] invalid env:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;

export const isProd = config.NODE_ENV === 'production';
export const isTestKey = config.STRIPE_SECRET_KEY.startsWith('sk_test_');
export const isLiveKey = config.STRIPE_SECRET_KEY.startsWith('sk_live_');

// Adapter 判定自己是否该走 mock fallback
// 任意必填密钥空 → mock
export const wechatConfigured =
  !!config.WECHAT_APPID && !!config.WECHAT_MCHID && !!config.WECHAT_API_V3_KEY
  && !!config.WECHAT_PRIVATE_KEY && !!config.WECHAT_SERIAL_NO;

export const alipayConfigured =
  !!config.ALIPAY_APP_ID && !!config.ALIPAY_PRIVATE_KEY && !!config.ALIPAY_PUBLIC_KEY;

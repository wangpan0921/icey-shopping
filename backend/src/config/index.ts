// 统一环境变量读取 + 校验
// 优点：启动时 fail-fast，避免生产环境漏配密钥到跑时才炸
import 'dotenv/config';
import { z } from 'zod';

const providerSchema = z.enum(['mock', 'stripe']);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1).default('file:./dev.db'),

  PAYMENT_PROVIDER: providerSchema.default('mock'),

  // Stripe 相关可空；仅在 PAYMENT_PROVIDER=stripe 时校验必填（见下面 refine）
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_CURRENCY: z.string().default('usd'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
}).superRefine((v, ctx) => {
  if (v.PAYMENT_PROVIDER === 'stripe') {
    if (!v.STRIPE_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRIPE_SECRET_KEY'],
        message: 'STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe',
      });
    }
    // webhook secret 允许在开发时后补（stripe listen 生成），生产必须有
    if (v.NODE_ENV === 'production' && !v.STRIPE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRIPE_WEBHOOK_SECRET'],
        message: 'STRIPE_WEBHOOK_SECRET is required in production',
      });
    }
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // 直接把错误抛清楚；避免 "undefined is not a function" 到跑时
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

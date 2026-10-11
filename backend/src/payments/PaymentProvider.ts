import type {
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedEvent,
  ProviderName,
} from './types.js';

// 任何新渠道只要实现这一组方法，就能接入主流程
export interface PaymentProvider {
  readonly name: ProviderName;

  // 创建支付（下单到渠道）
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  // 校验 webhook 请求签名 + 归一化事件（上游会强制通过此方法去除脏数据）
  // rawBody 必须是未经解析的原始 bytes/string（否则 Stripe HMAC 对不上）
  verifyAndParseWebhook(args: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<NormalizedEvent>;

  // 主动查单（兜底：webhook 丢失时用）
  queryPayment?(providerRef: string): Promise<NormalizedEvent | null>;

  // 退款（本阶段先占位，Stripe adapter 已经可用）
  refund?(args: { providerRef: string; amountCents?: number }): Promise<void>;
}

// Mock 支付渠道：用于测试/CI 环境，无需任何第三方资质和密钥
// 行为：createPayment 直接返回一个"伪 Checkout URL"（前端 /pay/mock 页面），
// 用户点"模拟支付成功/失败"按钮触发后端 /api/payments/mock/confirm，走和真实 webhook 一样的事件归一化入口
import type { PaymentProvider } from '../PaymentProvider.js';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedEvent,
} from '../types.js';
import { config } from '../../config/index.js';

export class MockAdapter implements PaymentProvider {
  readonly name = 'mock' as const;

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerRef = `mock_${input.orderId}_${Date.now()}`;
    // 前端提供一个模拟支付页，支持点按钮触发 confirm
    const url = `${config.PUBLIC_WEB_URL}/pay/mock?orderNo=${encodeURIComponent(input.orderNo)}&providerRef=${encodeURIComponent(providerRef)}&amount=${input.amountCents}&currency=${input.currency}&channel=mock`;
    return { kind: 'redirect', url, providerRef };
  }

  // Mock 下没有真正的签名；webhook route 直接把 body 丢进来
  async verifyAndParseWebhook({ rawBody }: { rawBody: Buffer }): Promise<NormalizedEvent> {
    const body = JSON.parse(rawBody.toString('utf-8')) as {
      providerRef: string;
      outcome?: 'success' | 'failure';
      amountCents?: number;
      currency?: string;
    };
    return {
      eventId: `mock_${body.providerRef}_${body.outcome ?? 'success'}_${Date.now()}`,
      eventType: `mock.${body.outcome ?? 'success'}`,
      providerRef: body.providerRef,
      status: body.outcome === 'failure' ? 'FAILED' : 'SUCCEEDED',
      amountCents: body.amountCents,
      currency: body.currency,
      rawPayload: body,
    };
  }

  async queryPayment(): Promise<NormalizedEvent | null> {
    return null;
  }
}

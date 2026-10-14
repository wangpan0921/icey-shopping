// Stripe 适配器：Checkout Session 托管收银台方式
// 为什么用 Checkout 而不是自建卡表单：
//   1. 免 PCI-DSS 合规负担（SAQ A）
//   2. 内置 3DS、Apple Pay/Google Pay、各国本地支付方式
//   3. 托管页天然自适应 PC/手机，响应式一套搞定
import Stripe from 'stripe';
import { config } from '../../config/index.js';
import { logger } from '../../common/logger.js';
import type { PaymentProvider } from '../PaymentProvider.js';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedEvent,
} from '../types.js';

export class StripeAdapter implements PaymentProvider {
  readonly name = 'stripe' as const;
  private readonly stripe: Stripe | null;
  private readonly configured: boolean;

  constructor() {
    this.configured = !!config.STRIPE_SECRET_KEY;
    if (this.configured) {
      this.stripe = new Stripe(config.STRIPE_SECRET_KEY, {
        // 固定 apiVersion，升级 Stripe SDK 时才去动它，避免行为突变
        apiVersion: '2024-10-28.acacia',
        typescript: true,
        appInfo: { name: 'icey-shopping', version: '0.1.0' },
      });
    } else {
      this.stripe = null;
      logger.warn('[stripe] STRIPE_SECRET_KEY not set, running in MOCK fallback mode');
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    // Mock fallback：没密钥时跳到 /pay/mock 走假流程
    if (!this.stripe) {
      const providerRef = `stripe_mock_${input.orderId}_${Date.now()}`;
      const url = `${config.PUBLIC_WEB_URL}/pay/mock?orderNo=${encodeURIComponent(input.orderNo)}&providerRef=${encodeURIComponent(providerRef)}&amount=${input.amountCents}&currency=${input.currency}&channel=stripe`;
      return { kind: 'redirect', url, providerRef };
    }

    const successUrl = `${config.PUBLIC_WEB_URL}/pay/result?orderNo=${encodeURIComponent(
      input.orderNo,
    )}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${config.PUBLIC_WEB_URL}/pay/cancel?orderNo=${encodeURIComponent(input.orderNo)}`;

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      // 一个 session 一个订单，便于用 orderNo 回查
      client_reference_id: input.orderId,
      customer_email: input.buyerEmail,
      line_items: input.lineItems.map((it) => ({
        quantity: it.quantity,
        price_data: {
          currency: input.currency,
          unit_amount: it.unitPriceCents,
          product_data: { name: it.name },
        },
      })),
      payment_intent_data: {
        description: input.description,
        metadata: { orderId: input.orderId, orderNo: input.orderNo },
      },
      metadata: { orderId: input.orderId, orderNo: input.orderNo },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    logger.info(
      { orderId: input.orderId, sessionId: session.id },
      '[stripe] checkout session created',
    );

    return {
      kind: 'redirect',
      url: session.url,
      providerRef: session.id,
    };
  }

  async verifyAndParseWebhook({
    rawBody,
    headers,
  }: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<NormalizedEvent> {
    // Mock fallback：没密钥时读 payload 的明文字段（与 wechat/alipay 一致）
    if (!this.stripe) {
      const body = JSON.parse(rawBody.toString('utf-8')) as {
        providerRef?: string;
        outcome?: 'success' | 'failure';
        amountCents?: number;
        currency?: string;
      };
      return {
        eventId: `stripe_mock_${body.providerRef}_${body.outcome ?? 'success'}_${Date.now()}`,
        eventType: `stripe.mock.${body.outcome ?? 'success'}`,
        providerRef: body.providerRef ?? '',
        status: body.outcome === 'failure' ? 'FAILED' : 'SUCCEEDED',
        amountCents: body.amountCents,
        currency: body.currency,
        rawPayload: body,
      };
    }

    if (!config.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    const sig = headers['stripe-signature'];
    if (!sig || Array.isArray(sig)) {
      throw new Error('Missing stripe-signature header');
    }

    // constructEvent 内部做 HMAC-SHA256 验签 + 时间戳容差（默认 5min）
    // 失败会抛，直接作为 400 返回
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      sig,
      config.STRIPE_WEBHOOK_SECRET,
    );

    return this.normalize(event);
  }

  async queryPayment(providerRef: string): Promise<NormalizedEvent | null> {
    if (!this.stripe) return null;
    try {
      const session = await this.stripe.checkout.sessions.retrieve(providerRef);
      return this.normalizeFromSession(session);
    } catch (err) {
      logger.warn({ err, providerRef }, '[stripe] queryPayment failed');
      return null;
    }
  }

  async refund({ providerRef, amountCents }: { providerRef: string; amountCents?: number }) {
    if (!this.stripe) throw new Error('stripe not configured, cannot refund in mock mode');
    // Checkout Session -> payment_intent -> refund
    const session = await this.stripe.checkout.sessions.retrieve(providerRef);
    const paymentIntent =
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntent) throw new Error('No payment_intent on session');
    await this.stripe.refunds.create({
      payment_intent: paymentIntent,
      amount: amountCents,
    });
  }

  // ---- helpers ----

  private normalize(event: Stripe.Event): NormalizedEvent {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = event.data.object as Stripe.Checkout.Session;
        return {
          eventId: event.id,
          eventType: event.type,
          providerRef: s.id,
          status:
            s.payment_status === 'paid' || s.payment_status === 'no_payment_required'
              ? 'SUCCEEDED'
              : 'PENDING',
          amountCents: s.amount_total ?? undefined,
          currency: s.currency ?? undefined,
          rawPayload: event,
        };
      }
      case 'checkout.session.expired': {
        const s = event.data.object as Stripe.Checkout.Session;
        return {
          eventId: event.id,
          eventType: event.type,
          providerRef: s.id,
          status: 'EXPIRED',
          rawPayload: event,
        };
      }
      case 'checkout.session.async_payment_failed': {
        const s = event.data.object as Stripe.Checkout.Session;
        return {
          eventId: event.id,
          eventType: event.type,
          providerRef: s.id,
          status: 'FAILED',
          rawPayload: event,
        };
      }
      case 'charge.refunded': {
        const c = event.data.object as Stripe.Charge;
        return {
          eventId: event.id,
          eventType: event.type,
          // charge.refunded 带的是 charge/paymentIntent，不是 session；
          // 这里塞 payment_intent，webhook 处理层会再按 providerRef 回查我们记录的映射
          providerRef: (c.payment_intent as string) ?? c.id,
          status: 'REFUNDED',
          amountCents: c.amount_refunded,
          currency: c.currency,
          rawPayload: event,
        };
      }
      default:
        // 其他事件不改状态，但记录到 PaymentEvent 以供审计
        return {
          eventId: event.id,
          eventType: event.type,
          providerRef: (event.data.object as { id?: string }).id ?? '',
          status: 'PENDING',
          rawPayload: event,
        };
    }
  }

  private normalizeFromSession(s: Stripe.Checkout.Session): NormalizedEvent {
    return {
      eventId: `query_${s.id}`,
      eventType: 'query.checkout.session',
      providerRef: s.id,
      status:
        s.payment_status === 'paid' || s.payment_status === 'no_payment_required'
          ? 'SUCCEEDED'
          : s.status === 'expired'
            ? 'EXPIRED'
            : 'PENDING',
      amountCents: s.amount_total ?? undefined,
      currency: s.currency ?? undefined,
      rawPayload: s,
    };
  }
}

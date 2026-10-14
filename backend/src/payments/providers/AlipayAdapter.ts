// 支付宝适配器
// 调起方式：
//   - PC 浏览器 (platform=pc_web)   → alipay.trade.page.pay  (电脑网站支付)   → kind: redirect
//   - 手机浏览器 (platform=mobile_web) → alipay.trade.wap.pay (手机网站支付) → kind: redirect
//   - 微信小程序 / Android App 后续按需扩展（返回 kind: jsapi / app_sdk）
//
// 密钥完整时走官方 SDK；任意必填密钥空时走 mock fallback，返回假 redirect 跳到 /pay/mock 页面。
// 这样 PAYMENT_PROVIDER=alipay 在没有资质的开发期也能完整跑一条前端流程。
//
// 已验证真坑（来源：indie-dev-payment-integration 记忆的通用规则）：
//   - 加签必须含 sign_type；时间戳用 GMT+8；沙箱/正式密钥与网关要成对配置；私钥只放服务端。
//   - 官方 alipay-sdk 已经把加签细节封装好；我们只需正确传密钥和 gateway。
import { AlipaySdk } from 'alipay-sdk';
import { config, alipayConfigured } from '../../config/index.js';
import { logger } from '../../common/logger.js';
import type { PaymentProvider } from '../PaymentProvider.js';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedEvent,
} from '../types.js';

export class AlipayAdapter implements PaymentProvider {
  readonly name = 'alipay' as const;
  private readonly sdk: AlipaySdk | null;
  private readonly configured: boolean;

  constructor() {
    this.configured = alipayConfigured;
    if (this.configured) {
      // 字面 \n 还原成真实换行
      const privateKey = config.ALIPAY_PRIVATE_KEY.replace(/\\n/g, '\n');
      const publicKey = config.ALIPAY_PUBLIC_KEY.replace(/\\n/g, '\n');
      this.sdk = new AlipaySdk({
        appId: config.ALIPAY_APP_ID,
        privateKey,
        alipayPublicKey: publicKey,
        gateway: config.ALIPAY_GATEWAY,
        signType: 'RSA2',
        timeout: 10_000,
        camelcase: true,
      });
    } else {
      this.sdk = null;
      logger.warn('[alipay] not fully configured, running in MOCK fallback mode');
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const notifyUrl = `${config.PUBLIC_API_URL}/api/webhooks/alipay`;
    const returnUrl = `${config.PUBLIC_WEB_URL}/pay/result?orderNo=${encodeURIComponent(input.orderNo)}`;

    // 金额用元为单位的字符串，保留两位小数（Alipay 要求）
    const totalAmount = (input.amountCents / 100).toFixed(2);

    // Mock fallback：密钥不全时直接返回假 redirect，仍然走 /pay/mock
    if (!this.sdk) {
      const providerRef = `alipay_mock_${input.orderId}_${Date.now()}`;
      const url = `${config.PUBLIC_WEB_URL}/pay/mock?orderNo=${encodeURIComponent(input.orderNo)}&providerRef=${encodeURIComponent(providerRef)}&amount=${input.amountCents}&currency=${input.currency}&channel=alipay`;
      return { kind: 'redirect', url, providerRef };
    }

    const method =
      input.client.platform === 'mobile_web'
        ? 'alipay.trade.wap.pay'
        : 'alipay.trade.page.pay';

    // 使用 sdkExecute 得到完整跳转 URL（页面跳转方式）
    const bizContent = {
      outTradeNo: input.orderNo,         // 商户订单号（支付宝 outTradeNo = 我们的 orderNo）
      totalAmount,
      subject: input.description || `Order ${input.orderNo}`,
      productCode: method === 'alipay.trade.wap.pay' ? 'QUICK_WAP_WAY' : 'FAST_INSTANT_TRADE_PAY',
    };

    const url = this.sdk.pageExec(method, {
      notifyUrl,
      returnUrl,
      bizContent,
    });

    logger.info({ orderId: input.orderId, method, outTradeNo: input.orderNo }, '[alipay] redirect url generated');

    return { kind: 'redirect', url, providerRef: input.orderNo };
  }

  async verifyAndParseWebhook({
    rawBody,
  }: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<NormalizedEvent> {
    // 支付宝 webhook 是 application/x-www-form-urlencoded
    const bodyStr = rawBody.toString('utf-8');
    const params: Record<string, string> = {};
    for (const pair of bodyStr.split('&')) {
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const k = decodeURIComponent(pair.slice(0, idx));
      const v = decodeURIComponent(pair.slice(idx + 1));
      params[k] = v;
    }

    // Mock fallback：没 SDK 时跳过验签（dev 场景）
    if (!this.sdk) {
      const amtStr = params.total_amount;
      return {
        eventId: `alipay_mock_${params.out_trade_no}_${Date.now()}`,
        eventType: `alipay.${params.trade_status ?? 'TRADE_SUCCESS'}`,
        providerRef: params.out_trade_no ?? '',
        status: params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED' ? 'SUCCEEDED' : 'PENDING',
        // 不写死币种：mock 场景下忽略币种校验，真实回调才核对
        ...(amtStr != null ? { amountCents: Math.round(Number(amtStr) * 100) } : {}),
        rawPayload: params,
      };
    }

    // 真实验签：SDK v4 的 checkNotifySign 方法
    const valid = this.sdk.checkNotifySign(params);
    if (!valid) throw new Error('Alipay signature invalid');

    const status =
      params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED'
        ? 'SUCCEEDED'
        : params.trade_status === 'TRADE_CLOSED'
          ? 'EXPIRED'
          : 'PENDING';

    return {
      eventId: params.notify_id ?? `alipay_${params.out_trade_no}_${params.trade_status}`,
      eventType: `alipay.${params.trade_status ?? 'UNKNOWN'}`,
      providerRef: params.out_trade_no ?? '',
      status,
      amountCents: Math.round(Number(params.total_amount ?? '0') * 100),
      currency: 'cny',
      rawPayload: params,
    };
  }

  async queryPayment(providerRef: string): Promise<NormalizedEvent | null> {
    if (!this.sdk) return null;
    try {
      const res = await this.sdk.exec('alipay.trade.query', {
        bizContent: { outTradeNo: providerRef },
      }) as { tradeStatus?: string; totalAmount?: string; tradeNo?: string };
      return {
        eventId: `alipay_query_${providerRef}_${Date.now()}`,
        eventType: `alipay.query.${res.tradeStatus ?? 'UNKNOWN'}`,
        providerRef,
        status:
          res.tradeStatus === 'TRADE_SUCCESS' || res.tradeStatus === 'TRADE_FINISHED'
            ? 'SUCCEEDED'
            : res.tradeStatus === 'TRADE_CLOSED'
              ? 'EXPIRED'
              : 'PENDING',
        amountCents: res.totalAmount ? Math.round(Number(res.totalAmount) * 100) : undefined,
        currency: 'cny',
        rawPayload: res,
      };
    } catch (err) {
      logger.warn({ err, providerRef }, '[alipay] queryPayment failed');
      return null;
    }
  }

  async refund({ providerRef, amountCents }: { providerRef: string; amountCents?: number }) {
    if (!this.sdk) throw new Error('alipay not configured, cannot refund in mock mode');
    await this.sdk.exec('alipay.trade.refund', {
      bizContent: {
        outTradeNo: providerRef,
        refundAmount: amountCents != null ? (amountCents / 100).toFixed(2) : undefined,
      },
    });
  }
}

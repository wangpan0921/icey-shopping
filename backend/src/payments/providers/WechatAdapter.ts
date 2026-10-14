// 微信支付 v3 适配器
// 调起方式（按 client.platform 自动选）：
//   - pc_web          → Native 支付（返回 code_url 让前端画二维码）  → kind: qrcode
//   - mobile_web      → H5 支付（返回 mweb_url 跳转到微信唤起）     → kind: redirect
//   - mobile_web + inWechat / wechat_mp → JSAPI 支付（返回参数给前端 wx.chooseWXPay）→ kind: jsapi
//   - android_app / ios_app → App 支付（返回参数给原生 SDK）        → kind: app_sdk
//
// 密钥不全时走 mock fallback，返回假 redirect 跳 /pay/mock，流程演示用。
//
// 已验证规则：
//   - 商户私钥、API v3 密钥、证书序列号三件套必须和商户号配对；错配报 "商户号不正确" 等。
//   - WECHAT_PRIVATE_KEY 支持 \n 字面换行，启动时自动还原（.env 单行易写）。
import WechatPay from 'wechatpay-node-v3';
import { config, wechatConfigured } from '../../config/index.js';
import { logger } from '../../common/logger.js';
import type { PaymentProvider } from '../PaymentProvider.js';
import type {
  ClientContext,
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedEvent,
} from '../types.js';

export class WechatAdapter implements PaymentProvider {
  readonly name = 'wechat' as const;
  private readonly pay: WechatPay | null;
  private readonly configured: boolean;

  constructor() {
    this.configured = wechatConfigured;
    if (this.configured) {
      const privateKey = config.WECHAT_PRIVATE_KEY.replace(/\\n/g, '\n');
      this.pay = new WechatPay({
        appid: config.WECHAT_APPID,
        mchid: config.WECHAT_MCHID,
        publicKey: Buffer.from(privateKey), // SDK 命名历史遗留：publicKey 其实是商户私钥
        privateKey: Buffer.from(privateKey),
        key: config.WECHAT_API_V3_KEY,
        serial_no: config.WECHAT_SERIAL_NO,
      });
    } else {
      this.pay = null;
      logger.warn('[wechat] not fully configured, running in MOCK fallback mode');
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const notifyUrl = `${config.PUBLIC_API_URL}/api/webhooks/wechat`;

    // Mock fallback
    if (!this.pay) {
      const providerRef = `wechat_mock_${input.orderId}_${Date.now()}`;
      const url = `${config.PUBLIC_WEB_URL}/pay/mock?orderNo=${encodeURIComponent(input.orderNo)}&providerRef=${encodeURIComponent(providerRef)}&amount=${input.amountCents}&currency=${input.currency}&channel=wechat`;
      return { kind: 'redirect', url, providerRef };
    }

    const baseParams = {
      appid: config.WECHAT_APPID,
      mchid: config.WECHAT_MCHID,
      description: input.description || `Order ${input.orderNo}`,
      out_trade_no: input.orderNo,
      notify_url: notifyUrl,
      amount: { total: input.amountCents, currency: 'CNY' },
    };

    const mode = pickMode(input.client);
    logger.info({ orderId: input.orderId, mode, platform: input.client.platform }, '[wechat] creating payment');

    switch (mode) {
      case 'native': {
        const r = (await this.pay.transactions_native(baseParams)) as { code_url?: string; data?: { code_url?: string } };
        const codeUrl = r.code_url ?? r.data?.code_url;
        if (!codeUrl) throw new Error('Wechat Native: code_url missing');
        return { kind: 'qrcode', qrCodeUrl: codeUrl, providerRef: input.orderNo };
      }
      case 'h5': {
        const r = (await this.pay.transactions_h5({
          ...baseParams,
          scene_info: {
            payer_client_ip: '0.0.0.0',
            h5_info: { type: 'Wap', app_name: 'icey-shopping' },
          },
        })) as { h5_url?: string; data?: { h5_url?: string } };
        const h5Url = r.h5_url ?? r.data?.h5_url;
        if (!h5Url) throw new Error('Wechat H5: h5_url missing');
        return { kind: 'redirect', url: h5Url, providerRef: input.orderNo };
      }
      case 'jsapi': {
        if (!input.client.openid) throw new Error('Wechat JSAPI requires client.openid');
        const r = (await this.pay.transactions_jsapi({
          ...baseParams,
          payer: { openid: input.client.openid },
        })) as unknown as Record<string, string>;
        // SDK 返回已经签名好的调起参数（timeStamp/nonceStr/package/signType/paySign）
        return {
          kind: 'jsapi',
          params: {
            appId: config.WECHAT_APPID,
            timeStamp: String(r.timeStamp ?? ''),
            nonceStr: String(r.nonceStr ?? ''),
            package: String(r.package ?? ''),
            signType: 'RSA',
            paySign: String(r.paySign ?? ''),
          },
          providerRef: input.orderNo,
        };
      }
      case 'app': {
        const r = (await this.pay.transactions_app(baseParams)) as unknown as Record<string, string>;
        return {
          kind: 'app_sdk',
          params: {
            appid: config.WECHAT_APPID,
            partnerid: config.WECHAT_MCHID,
            prepayid: String(r.prepayid ?? r.prepay_id ?? ''),
            timestamp: String(r.timestamp ?? ''),
            noncestr: String(r.noncestr ?? r.nonceStr ?? ''),
            package: 'Sign=WXPay',
            sign: String(r.sign ?? r.paySign ?? ''),
          },
          providerRef: input.orderNo,
        };
      }
    }
  }

  async verifyAndParseWebhook({
    rawBody,
    headers,
  }: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<NormalizedEvent> {
    const payload = JSON.parse(rawBody.toString('utf-8')) as {
      id?: string;
      event_type?: string;
      resource?: { ciphertext: string; associated_data?: string; nonce: string };
    };

    // Mock fallback：直接读 payload 的明文字段
    if (!this.pay) {
      const anyPayload = payload as unknown as { out_trade_no?: string; trade_state?: string; amount?: { total?: number } };
      return {
        eventId: payload.id ?? `wechat_mock_${Date.now()}`,
        eventType: `wechat.${payload.event_type ?? 'TRANSACTION.SUCCESS'}`,
        providerRef: anyPayload.out_trade_no ?? '',
        status: anyPayload.trade_state === 'SUCCESS' ? 'SUCCEEDED' : 'PENDING',
        // 不写死币种：mock 场景下忽略币种校验，真实回调才核对
        ...(anyPayload.amount?.total != null ? { amountCents: anyPayload.amount.total } : {}),
        rawPayload: payload,
      };
    }

    // 真实验签 + 解密
    const timestamp = String(headers['wechatpay-timestamp'] ?? '');
    const nonce = String(headers['wechatpay-nonce'] ?? '');
    const signature = String(headers['wechatpay-signature'] ?? '');
    const serial = String(headers['wechatpay-serial'] ?? '');

    const valid = this.pay.verifySign({ timestamp, nonce, body: rawBody.toString('utf-8'), serial, signature });
    if (!valid) throw new Error('Wechat signature invalid');

    const resource = payload.resource!;
    const decrypted = this.pay.decipher_gcm<{ out_trade_no: string; trade_state: string; amount: { total: number } }>(
      resource.ciphertext,
      resource.associated_data ?? '',
      resource.nonce,
      config.WECHAT_API_V3_KEY,
    );

    return {
      eventId: payload.id ?? `wechat_${decrypted.out_trade_no}_${Date.now()}`,
      eventType: `wechat.${payload.event_type ?? 'UNKNOWN'}`,
      providerRef: decrypted.out_trade_no,
      status: decrypted.trade_state === 'SUCCESS' ? 'SUCCEEDED' : 'PENDING',
      amountCents: decrypted.amount?.total,
      currency: 'cny',
      rawPayload: { payload, decrypted },
    };
  }
}

// 根据客户端决定调起方式
function pickMode(client: ClientContext): 'native' | 'h5' | 'jsapi' | 'app' {
  if (client.platform === 'wechat_mp') return 'jsapi';
  if (client.platform === 'android_app' || client.platform === 'ios_app') return 'app';
  if (client.platform === 'mobile_web' && client.inWechat) return 'jsapi';
  if (client.platform === 'mobile_web') return 'h5';
  return 'native'; // pc_web
}

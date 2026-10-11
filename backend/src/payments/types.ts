// 支付领域的通用类型
// 刻意和具体渠道解耦，便于新增 wechat/alipay 时不改主流程
export type ProviderName = 'stripe' | 'mock' | 'wechat' | 'alipay';

// 下单时的客户端上下文：便于适配器按设备/场景生成正确的调起方式
// 比如将来接微信时：platform=mp 走 JSAPI，platform=mobile_web+inWechat 走 JSAPI，否则走 H5
export interface ClientContext {
  platform: 'pc_web' | 'mobile_web' | 'wechat_mp' | 'android_app' | 'ios_app';
  inWechat?: boolean;
  userAgent?: string;
  openid?: string; // 微信 JSAPI 需要
  returnUrl?: string; // 支付完成跳回的前端地址
  cancelUrl?: string;
}

export interface CreatePaymentInput {
  orderId: string;
  orderNo: string;
  amountCents: number;
  currency: string;
  // 商品描述，用于支付页展示 / 风控
  description: string;
  // 行项（Stripe Checkout line_items 等需要）
  lineItems: Array<{
    name: string;
    unitPriceCents: number;
    quantity: number;
  }>;
  buyerEmail?: string;
  client: ClientContext;
}

// 适配器返回的"调起 payload"
// 不同渠道差异大，所以用 kind 做区分，前端据此走不同的调起路径
export type CreatePaymentResult =
  | { kind: 'redirect'; url: string; providerRef: string } // Stripe Checkout / 支付宝 WAP
  | { kind: 'qrcode'; qrCodeUrl: string; providerRef: string } // 微信 Native
  | { kind: 'jsapi'; params: Record<string, string>; providerRef: string } // 微信 JSAPI
  | { kind: 'app_sdk'; params: Record<string, string>; providerRef: string } // 微信/支付宝 App SDK
  | { kind: 'mock_auto_success'; providerRef: string }; // 本地测试

// Webhook 事件归一化
export interface NormalizedEvent {
  eventId: string; // 渠道唯一事件 ID，用于幂等
  eventType: string; // 原始 type（审计 + 调试）
  // 事件对应的支付（通过 providerRef 关联到 Payment）
  providerRef: string;
  // 当前支付状态
  status: 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'REFUNDED' | 'PENDING';
  // 收到的金额（最小货币单位），用于与订单核对，防金额被篡改
  amountCents?: number;
  currency?: string;
  rawPayload: unknown;
}

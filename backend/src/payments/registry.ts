// Provider 注册表：按配置返回当前默认 provider，并支持按名查找
// 新增渠道时只需在这里新加一个分支即可
import { config } from '../config/index.js';
import { logger } from '../common/logger.js';
import type { PaymentProvider } from './PaymentProvider.js';
import { StripeAdapter } from './providers/StripeAdapter.js';
import { MockAdapter } from './providers/MockAdapter.js';
import type { ProviderName } from './types.js';

const instances = new Map<ProviderName, PaymentProvider>();

export function getProvider(name?: ProviderName): PaymentProvider {
  const target = name ?? (config.PAYMENT_PROVIDER as ProviderName);
  const cached = instances.get(target);
  if (cached) return cached;

  let instance: PaymentProvider;
  switch (target) {
    case 'stripe':
      instance = new StripeAdapter();
      break;
    case 'mock':
      instance = new MockAdapter();
      break;
    case 'wechat':
    case 'alipay':
      // 占位：日后扩展时在 providers/ 下加文件 + 这里 new
      throw new Error(
        `[payments] provider "${target}" is not implemented yet; add an adapter under providers/`,
      );
    default:
      throw new Error(`[payments] unknown provider: ${String(target)}`);
  }
  instances.set(target, instance);
  logger.info({ provider: target }, '[payments] provider initialized');
  return instance;
}

export const defaultProvider = (): PaymentProvider => getProvider();

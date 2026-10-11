import { customAlphabet } from 'nanoid';

// 大写 + 数字，避免歧义字符（去掉 0/O/1/I）
const nanoid = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 10);

// 对外订单号：时间前缀 + 随机，方便客服肉眼区分日期
export function newOrderNo(): string {
  const d = new Date();
  const yyyymmdd =
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0');
  return `IS${yyyymmdd}${nanoid()}`;
}

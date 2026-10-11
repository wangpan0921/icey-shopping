import { pino } from 'pino';
import { config, isProd } from '../config/index.js';

export const logger = pino({
  level: isProd ? 'info' : 'debug',
  // 开发态美化输出；生产保持 JSON，便于被日志平台采集
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, singleLine: true, translateTime: 'HH:MM:ss' },
      },
  base: { env: config.NODE_ENV },
});

import type { D1Migration } from 'ugly-app/server';
import { newsRetentionBacklog } from './001_news_retention_backlog';
import { newsIndexCleanup } from './002_news_index_cleanup';

/** Every D1 migration this app ships, in run order (run once each by /_init). */
export const d1Migrations: readonly D1Migration[] = [
  newsRetentionBacklog,
  newsIndexCleanup,
];

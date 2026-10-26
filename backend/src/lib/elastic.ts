import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';

// One client per process; it manages its own HTTP connection pool to Elasticsearch.
// null when ELASTICSEARCH_URL isn't set: search then falls back to Postgres.
export const elastic: Client | null = env.ELASTICSEARCH_URL
  ? new Client({ node: env.ELASTICSEARCH_URL, requestTimeout: 5_000 })
  : null;

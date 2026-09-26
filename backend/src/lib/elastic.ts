import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';

// One client per process; it manages its own HTTP connection pool to Elasticsearch.
export const elastic = new Client({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: 5_000,
});

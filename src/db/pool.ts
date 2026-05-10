import pg from 'pg';

import { env } from '../config/env.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
});

export async function closePool(): Promise<void> {
  await pool.end();
}

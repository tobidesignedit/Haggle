import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Pool as PoolType } from 'pg';
import * as schema from './schema';

const { Pool } = pg;

declare global {
  var _postgresPool: PoolType | undefined;
}

export function hasPostgresConfig(): boolean {
  return Boolean(
    (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') ||
      (process.env.SQL_HOST && process.env.SQL_HOST.trim() !== '')
  );
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = process.env.DATABASE_URL
      ? new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 10,
          connectionTimeoutMillis: 5000,
        })
      : new Pool({
          host: process.env.SQL_HOST,
          user: process.env.SQL_USER,
          password: process.env.SQL_PASSWORD,
          database: process.env.SQL_DB_NAME,
          max: 10,
          connectionTimeoutMillis: 5000,
        });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });

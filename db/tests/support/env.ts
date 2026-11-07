// Environment access for the Verification_Suite. Only TEST_DATABASE_URL is read.
import { fileURLToPath } from 'node:url';

export const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const DB_VARIABLES = ['TEST_DATABASE_URL'] as const;

export function missingDbVariables(): string[] {
  return DB_VARIABLES.filter((name) => (process.env[name] ?? '').trim() === '');
}

export interface DbConnection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

export function parseDbUrl(url: string): DbConnection {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port === '' ? '5432' : parsed.port,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

export function testDatabaseUrl(): string {
  return process.env['TEST_DATABASE_URL'] ?? '';
}

export function connectionStringFor(connection: DbConnection, database: string): string {
  const user = encodeURIComponent(connection.user);
  const password = encodeURIComponent(connection.password);
  return `postgresql://${user}:${password}@${connection.host}:${connection.port}/${database}`;
}

export function jdbcUrlFor(connection: DbConnection, database: string): string {
  return `jdbc:postgresql://${connection.host}:${connection.port}/${database}`;
}

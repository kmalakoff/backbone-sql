import type { SQLiteConnectionOptions, SQLiteTarget } from './types.ts';

const SQLITE_PROTOCOLS = new Set(['sqlite:', 'sqlite3:']);

export function requireSQLProtocol(fullURL: string): 'sqlite:' | 'sqlite3:' | 'pg:' | 'postgres:' {
  const protocol = /^([a-z][a-z0-9+.-]*:)/i.exec(fullURL)?.[1].toLowerCase();
  switch (protocol) {
    case 'sqlite:':
    case 'sqlite3:':
    case 'pg:':
    case 'postgres:':
      return protocol;
    default:
      throw new Error('Unrecognized sql variant');
  }
}

interface ParsedDatabaseURL {
  host: string;
  protocol: string;
  table: string | null;
  format(options: Record<string, unknown>): string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function constructDatabaseURL(constructorValue: unknown, fullURL: string): ParsedDatabaseURL {
  if (typeof constructorValue !== 'function') {
    throw new Error('backbone-orm DatabaseURL must be a constructor');
  }

  const parsed: unknown = Reflect.construct(constructorValue, [fullURL]);
  if (!isRecord(parsed)) {
    throw new Error('backbone-orm DatabaseURL did not return an object');
  }

  const { format, host, protocol, table } = parsed;
  if (typeof format !== 'function' || typeof host !== 'string' || typeof protocol !== 'string' || (typeof table !== 'string' && table !== null)) {
    throw new Error('backbone-orm DatabaseURL does not satisfy the SQL adapter contract');
  }

  return {
    format(options: Record<string, unknown>): string {
      const value: unknown = Reflect.apply(format, parsed, [options]);
      if (typeof value !== 'string') {
        throw new Error('backbone-orm DatabaseURL.format must return a string');
      }
      return value;
    },
    host,
    protocol,
    table,
  };
}

export function resolveSQLiteTarget(fullURL: string, databaseURLConstructor: unknown, options: SQLiteConnectionOptions = {}): SQLiteTarget {
  if (!SQLITE_PROTOCOLS.has(requireSQLProtocol(fullURL))) throw new Error('Unrecognized sql variant');
  const databaseURL = constructDatabaseURL(databaseURLConstructor, fullURL);
  if (!SQLITE_PROTOCOLS.has(databaseURL.protocol)) {
    throw new Error('Unrecognized sql variant');
  }
  if (options.filename === '') {
    throw new Error('SQLite filename must not be empty');
  }

  return {
    filename: options.filename ?? (databaseURL.host || ':memory:'),
    poolKey: databaseURL.format({ exclude_query: true, exclude_table: true }),
    table: databaseURL.table,
  };
}

import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import type { DatabaseURLConstructor } from 'backbone-orm';

import { requireIdentifier } from './identifiers.ts';
import type { PostgreSQLTarget } from './types.ts';

const POSTGRESQL_PROTOCOLS = new Set(['pg:', 'postgres:']);

export function isPostgreSQLURL(fullURL: string): boolean {
  return POSTGRESQL_PROTOCOLS.has(fullURL.slice(0, fullURL.indexOf(':') + 1).toLowerCase());
}

export function resolvePostgreSQLTarget(fullURL: string, databaseURLConstructor: DatabaseURLConstructor): PostgreSQLTarget {
  if (!isPostgreSQLURL(fullURL)) throw new Error('Unsupported PostgreSQL URL protocol');
  if (fullURL.includes('?') || fullURL.includes('#')) throw new Error('PostgreSQL URL query, SSL and fragment settings are not implemented');
  const authority = /^[a-z]+:\/\/([^/?#]*)/i.exec(fullURL)?.[1];
  if (!authority) throw new Error('PostgreSQL URL requires one explicit host');
  const hostPart = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPart.includes(',')) throw new Error('PostgreSQL host lists are not implemented');

  let endpoint: URL;
  let user: string | undefined;
  let password: string | undefined;
  let database: string;
  let table: string;
  try {
    endpoint = new URL(fullURL.replace(/^[a-z]+:/i, 'postgres:'));
    const parsed = new databaseURLConstructor(fullURL);
    if (parsed.hosts || !parsed.hostname || !parsed.database || !parsed.table) throw new Error('Missing endpoint');
    if (!/^\/[^/]+\/[^/]+\/?$/.test(endpoint.pathname)) throw new Error('Unsupported path');
    const parts = endpoint.pathname.split('/');
    database = decodeURIComponent(parts[1]);
    table = decodeURIComponent(parts[2]);
    if (!database || database.includes('/') || database.includes('\0')) throw new Error('Invalid database');
    if (table.includes('.')) throw new Error('PostgreSQL schema namespaces are not implemented');
    // Decode separately so an encoded colon in either credential is not a separator.
    user = endpoint.username ? decodeURIComponent(endpoint.username) : undefined;
    password = endpoint.password ? decodeURIComponent(endpoint.password) : undefined;
    requireIdentifier(table, 'PostgreSQL table');
  } catch {
    // Parser errors can retain the secret-bearing URL, so no raw input or cause escapes.
    throw new Error('Invalid PostgreSQL model URL; require host, database and table');
  }
  const port = endpoint.port ? Number(endpoint.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PostgreSQL port');
  const authIdentity = createHash('sha256')
    .update(JSON.stringify([user ?? null, password ?? null]))
    .digest('hex');
  return {
    database,
    host: endpoint.hostname.replace(/^\[|\]$/g, ''),
    password,
    poolKey: `postgres://${endpoint.hostname}:${port}/${encodeURIComponent(database)}#auth=${authIdentity}`,
    port,
    table,
    user,
  };
}

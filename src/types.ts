import type SQLQuery from './internal/query.ts';
import type SQLSchema from './internal/schema.ts';
import type { ErrorCallback, OwnedPostgreSQLConnection, OwnedSQLConnection, ResultCallback, SQLConnection } from './internal/types.ts';

export interface SQLSchemaControlOptions {
  verbose?: boolean;
}

export interface SQLDatabaseControl<Connection extends SQLConnection> {
  readonly connection: Connection;
  readonly query: SQLQuery;
  readonly schema: SQLSchema;
  createOrUpdateTable(options: SQLSchemaControlOptions, callback: ErrorCallback): void;
  ensureSchema(callback: ErrorCallback): void;
  ensureSchema(options: SQLSchemaControlOptions, callback: ErrorCallback): void;
  resetSchema(callback: ErrorCallback): void;
  resetSchema(options: SQLSchemaControlOptions, callback: ErrorCallback): void;
  dropTable(callback: ResultCallback<unknown>): Promise<unknown>;
  dropTableIfExists(callback: ResultCallback<unknown>): Promise<unknown>;
  hasColumn(column: string, callback: ResultCallback<boolean>): Promise<boolean>;
  hasTable(callback: ResultCallback<boolean>): Promise<boolean>;
  renameTable(to: string, callback: ResultCallback<unknown>): Promise<unknown>;
}

export interface SQLiteDatabaseControl extends SQLDatabaseControl<OwnedSQLConnection> {}

export interface PostgreSQLDatabaseControl extends SQLDatabaseControl<OwnedPostgreSQLConnection> {}

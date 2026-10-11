import type { DatabaseURLConstructor, SchemaField } from 'backbone-orm';
import type { Knex } from 'knex';

export type ErrorCallback = (error?: Error | null) => void;
export type ResultCallback<T> = (error: Error | null, value?: T) => void;

export interface SQLiteConnectionDependencies {
  DatabaseURL: DatabaseURLConstructor;
}

export interface SQLiteConnectionOptions {
  filename?: string;
}

export interface SQLiteTarget {
  filename: string;
  poolKey: string;
  table: string | null;
}

export interface SQLConnection {
  readonly table: string | null;
  readonly url: string;
  destroy(): Promise<void>;
  destroy(callback: ErrorCallback): void;
  knex(): Knex;
}

export interface OwnedSQLConnection extends SQLConnection {
  readonly filename: string;
}

export interface PostgreSQLTarget {
  readonly database: string;
  readonly host: string;
  readonly password?: string;
  readonly poolKey: string;
  readonly port: number;
  readonly table: string;
  readonly user?: string;
}

export interface OwnedPostgreSQLConnection extends SQLConnection {
  readonly databaseName: string;
  readonly host: string;
  readonly port: number;
}

export interface SQLConnectionPool<Connection extends SQLConnection = SQLConnection> {
  get(key: string): Connection | undefined;
  closeConnection(fullURL: string): Promise<void>;
  closeConnection(fullURL: string, callback: ErrorCallback): void;
}

export type SQLInputRow = Record<string, unknown>;
export type SQLRow = Record<string, Knex.Value>;
export type SQLIdentifier = string;
export type SQLSort = string;

export interface SQLJoin {
  left: SQLIdentifier;
  right: SQLIdentifier;
  table: SQLIdentifier;
}

export interface SQLProjection {
  as?: SQLIdentifier;
  column: SQLIdentifier;
}

export interface SQLRelatedPredicate {
  innerColumn: SQLIdentifier;
  outerColumn: SQLIdentifier;
  table: SQLIdentifier;
  through?: SQLRelatedThrough;
  where: SQLWhere;
}

export interface SQLRelatedThrough {
  joinColumn: SQLIdentifier;
  relatedColumn: SQLIdentifier;
  table: SQLIdentifier;
}

export interface SQLPredicateGroup {
  related?: readonly SQLRelatedPredicate[];
  where?: SQLWhere;
}

export interface SQLSelectOptions {
  columns?: readonly SQLIdentifier[];
  ids?: readonly unknown[];
  joins?: readonly SQLJoin[];
  limit?: number;
  offset?: number;
  or?: readonly SQLPredicateGroup[];
  projections?: readonly SQLProjection[];
  related?: readonly SQLRelatedPredicate[];
  sort?: SQLSort | readonly SQLSort[];
  unique?: readonly SQLIdentifier[];
  where?: SQLWhere;
}

export type SQLWhere = Record<SQLIdentifier, unknown>;

export type SQLColumnType = 'bigIncrements' | 'bigInteger' | 'binary' | 'boolean' | 'date' | 'dateTime' | 'decimal' | 'double' | 'enu' | 'float' | 'increments' | 'integer' | 'json' | 'mediumint' | 'smallint' | 'string' | 'text' | 'time' | 'timestamp' | 'tinyint' | 'uuid';

export interface SQLColumnDefinition {
  constructorSource?: { readonly kind: 'original-schema'; readonly field: SchemaField };
  enumSource?: { readonly kind: 'original-schema'; readonly field: SchemaField };
  indexed?: boolean;
  length?: number;
  name: SQLIdentifier;
  nullable?: boolean;
  precision?: number;
  primary?: boolean;
  scale?: number;
  textType?: 'longtext' | 'mediumtext' | 'text';
  type: SQLColumnType;
  unique?: boolean;
  values?: readonly string[];
}

export interface SQLPage {
  offset: number;
  rows: SQLRow[];
  totalRows: number;
}

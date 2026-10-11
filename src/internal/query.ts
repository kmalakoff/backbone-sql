import type { Knex } from 'knex';

import { requireIdentifier, requireIdentifiers, requireLimit } from './identifiers.ts';
import { operationWorker, runWorker } from './settle.ts';
import type { ResultCallback, SQLInputRow, SQLPage, SQLPredicateGroup, SQLRelatedPredicate, SQLRow, SQLSelectOptions, SQLWhere } from './types.ts';

type QueryBuilder = Knex.QueryBuilder<SQLRow, SQLRow[]>;
type ComparisonOperator = '<' | '<=' | '!=' | '>=' | '>';
interface ParsedSort {
  column: string;
  order: 'asc' | 'desc';
}

const COMPARATORS: Readonly<Record<string, ComparisonOperator>> = {
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<=',
  $ne: '!=',
};
const RANK_COLUMN = '__backbone_sql_rank';
const RANKED_QUERY = '__backbone_sql_ranked';
const COUNT_QUERY = '__backbone_sql_count';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: The Node 18 TypeScript library target does not declare Object.hasOwn.
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireArray(value: unknown, operator: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${operator} requires an array`);
  return value;
}

function requireSQLValue(value: unknown): Knex.Value {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'string')) return value;
    if (value.every((entry) => typeof entry === 'number')) return value;
    if (value.every((entry) => typeof entry === 'boolean')) return value;
    if (value.every((entry) => entry instanceof Date)) return value;
    if (value.every((entry) => Buffer.isBuffer(entry))) return value;
    throw new Error('SQL array values must contain one supported value type');
  }
  if (isRecord(value)) return value;
  throw new Error(`Unsupported SQL value: ${String(value)}`);
}

function appendComparison(query: QueryBuilder, key: string, operator: ComparisonOperator, value: unknown): void {
  if (operator === '!=') {
    query.where(function compareNotEqual() {
      if (value === null) {
        this.whereNotNull(key);
      } else {
        this.where(key, operator, requireSQLValue(value)).orWhereNull(key);
      }
    });
    return;
  }
  if (value === null) throw new Error(`Unexpected null with query key '${key}' operator '${operator}'`);
  query.where(key, operator, requireSQLValue(value));
}

function appendCondition(query: QueryBuilder, keyValue: string, value: unknown): boolean {
  const key = requireIdentifier(keyValue, 'Query field');
  if (value === undefined) throw new Error(`Unexpected undefined for query key '${key}'`);

  if (isRecord(value) && hasOwn(value, '$in')) {
    const values = requireArray(value.$in, '$in');
    if (values.length === 0) return true;
    query.whereIn(key, values.map(requireSQLValue));
    return false;
  }

  if (isRecord(value) && hasOwn(value, '$nin')) {
    const values = requireArray(value.$nin, '$nin');
    if (values.length > 0) query.whereNotIn(key, values.map(requireSQLValue));
    return false;
  }

  if (isRecord(value) && hasOwn(value, '$exists')) {
    if (value.$exists) query.whereNotNull(key);
    else query.whereNull(key);
    return false;
  }

  if (isRecord(value)) {
    const comparisons = Object.entries(COMPARATORS).filter(([mongoOperator]) => hasOwn(value, mongoOperator));
    if (comparisons.length > 0) {
      query.where(function compareAll() {
        for (const [mongoOperator, sqlOperator] of comparisons) {
          appendComparison(this, key, sqlOperator, value[mongoOperator]);
        }
      });
      return false;
    }
  }

  if (value === null) query.whereNull(key);
  else query.where(key, requireSQLValue(value));
  return false;
}

function appendWhere(query: QueryBuilder, where: SQLWhere = {}): boolean {
  let aborted = false;
  for (const [key, value] of Object.entries(where)) {
    if (appendCondition(query, key, value)) aborted = true;
  }
  return aborted;
}

function requireUnqualifiedIdentifier(identifier: string, label: string): string {
  const value = requireIdentifier(identifier, label);
  if (value.includes('.')) throw new Error(`${label} must be unqualified: ${identifier}`);
  return value;
}

function qualifiedIdentifier(tableValue: string, columnValue: string, label: string): string {
  const table = requireUnqualifiedIdentifier(tableValue, `${label} table`);
  const column = requireUnqualifiedIdentifier(columnValue, `${label} column`);
  return `${table}.${column}`;
}

function qualifiedWhere(table: string, where: SQLWhere): SQLWhere {
  const result: SQLWhere = {};
  for (const [column, value] of Object.entries(where)) {
    result[qualifiedIdentifier(table, column, 'Related query field')] = value;
  }
  return result;
}

function appendRelatedPredicate(query: QueryBuilder, predicate: SQLRelatedPredicate, database: Knex, parentTableValue: string): void {
  const parentTable = requireUnqualifiedIdentifier(parentTableValue, 'Parent table');
  const predicateTable = requireUnqualifiedIdentifier(predicate.table, 'Related table');
  if (predicateTable === parentTable) throw new Error(`SQL self-related predicates require distinct aliases: ${parentTable}`);

  let whereTable = predicateTable;
  let throughTable: string | undefined;
  let throughJoinColumn: string | undefined;
  let throughRelatedColumn: string | undefined;
  if (predicate.through) {
    throughTable = requireUnqualifiedIdentifier(predicate.through.table, 'Related through table');
    if (throughTable === parentTable || throughTable === predicateTable) {
      throw new Error(`SQL self-related predicates require distinct aliases: ${parentTable}`);
    }
    throughJoinColumn = qualifiedIdentifier(predicateTable, predicate.through.joinColumn, 'Related through join');
    throughRelatedColumn = qualifiedIdentifier(throughTable, predicate.through.relatedColumn, 'Related through relation');
    whereTable = throughTable;
  }

  const innerColumn = qualifiedIdentifier(predicateTable, predicate.innerColumn, 'Related correlation');
  const outerColumn = qualifiedIdentifier(parentTable, predicate.outerColumn, 'Parent correlation');
  const where = qualifiedWhere(whereTable, predicate.where);
  query.whereExists(function relatedExists() {
    this.select(database.raw('1')).from(predicateTable).whereRaw('?? = ??', [innerColumn, outerColumn]);
    if (throughTable && throughJoinColumn && throughRelatedColumn) {
      this.innerJoin(throughTable, throughJoinColumn, '=', throughRelatedColumn);
    }
    if (appendWhere(this, where)) this.whereRaw('1 = 0');
  });
}

function appendPredicateGroup(query: QueryBuilder, group: SQLPredicateGroup, database: Knex, parentTable: string): boolean {
  const aborted = appendWhere(query, group.where);
  for (const predicate of group.related ?? []) appendRelatedPredicate(query, predicate, database, parentTable);
  return aborted;
}

function appendOr(query: QueryBuilder, alternatives: readonly SQLPredicateGroup[] | undefined, database: Knex, parentTable: string): void {
  if (!alternatives || alternatives.length === 0) return;

  query.where(function compareAlternatives() {
    alternatives.forEach((alternative, index) => {
      const appendAlternative = function appendAlternative(this: QueryBuilder) {
        if (appendPredicateGroup(this, alternative, database, parentTable)) this.whereRaw('1 = 0');
      };
      if (index === 0) this.where(appendAlternative);
      else this.orWhere(appendAlternative);
    });
  });
}

function parseSort(sort: string): ParsedSort {
  const descending = sort.startsWith('-');
  const column = requireIdentifier(descending ? sort.slice(1) : sort, 'Sort field');
  return { column, order: descending ? 'desc' : 'asc' };
}

function parseSorts(sort: SQLSelectOptions['sort'], defaults: readonly string[] = []): ParsedSort[] {
  const values = sort === undefined ? defaults : typeof sort === 'string' ? [sort] : sort;
  return values.map(parseSort);
}

function appendSorts(query: QueryBuilder, sorts: readonly ParsedSort[]): void {
  for (const { column, order } of sorts) {
    query.orderBy(column, order);
  }
}

function appendLimits(query: QueryBuilder, options: SQLSelectOptions): QueryBuilder {
  const limit = requireLimit(options.limit, 'Query limit');
  const offset = requireLimit(options.offset, 'Query offset');
  if (limit !== undefined) query.limit(limit);
  if (offset !== undefined) query.offset(offset);
  return query;
}

function appendSortAndLimits(query: QueryBuilder, options: SQLSelectOptions): QueryBuilder {
  appendSorts(query, parseSorts(options.sort));
  return appendLimits(query, options);
}

function normalizeInputRow(row: SQLInputRow, label: string): SQLRow {
  const normalized: SQLRow = {};
  for (const [keyValue, value] of Object.entries(row)) {
    const key = requireIdentifier(keyValue, label);
    normalized[key] = requireSQLValue(value);
  }
  return normalized;
}

function normalizeInteger(value: unknown, label: string): number {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`${label} exceeds the safe integer range`);
    }
    return Number(value);
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return normalizeInteger(BigInt(value), label);
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label} is not a safe integer`);
  }
  return value;
}

export function normalizeCount(rowsValue: unknown): number {
  if (!Array.isArray(rowsValue) || rowsValue.length === 0) return 0;
  const row: unknown = rowsValue[0];
  if (!isRecord(row) || !hasOwn(row, 'count')) throw new Error('Count query did not return a count column');
  return normalizeInteger(row.count, 'Count');
}

export function normalizeReturningID(result: unknown, idColumn = 'id'): string | number {
  requireIdentifier(idColumn, 'ID column');
  if (!Array.isArray(result) || result.length === 0) throw new Error('Insert did not return an identifier');

  const first: unknown = result[0];
  const value = isRecord(first) ? first[idColumn] : first;
  if (typeof value === 'string') return value;
  return normalizeInteger(value, 'Inserted identifier');
}

export default class SQLQuery {
  readonly table: string;

  private readonly database: Knex;

  constructor(database: Knex, table: string) {
    this.database = database;
    this.table = requireIdentifier(table, 'Table name');
  }

  insert(row: SQLInputRow, idColumn?: string): Promise<string | number>;
  insert(row: SQLInputRow, idColumn: string | undefined, callback: ResultCallback<string | number>): void;
  insert(row: SQLInputRow, idColumn = 'id', callback?: ResultCallback<string | number>): Promise<string | number> | void {
    const worker = operationWorker(() => {
      const identifier = requireIdentifier(idColumn, 'ID column');
      return this.database<SQLRow>(this.table)
        .insert(normalizeInputRow(row, 'Inserted field'))
        .returning(identifier)
        .then((result: unknown) => normalizeReturningID(result, identifier));
    });
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  select(options?: SQLSelectOptions): Promise<SQLRow[]>;
  select(options: SQLSelectOptions | undefined, callback: ResultCallback<SQLRow[]>): void;
  select(options: SQLSelectOptions = {}, callback?: ResultCallback<SQLRow[]>): Promise<SQLRow[]> | void {
    const worker = operationWorker(() => this.selectOperation(options));
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  count(options?: SQLSelectOptions): Promise<number>;
  count(options: SQLSelectOptions | undefined, callback: ResultCallback<number>): void;
  count(options: SQLSelectOptions = {}, callback?: ResultCallback<number>): Promise<number> | void {
    const worker = operationWorker(() => this.countOperation(options));
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  exists(options?: SQLSelectOptions): Promise<boolean>;
  exists(options: SQLSelectOptions | undefined, callback: ResultCallback<boolean>): void;
  exists(options: SQLSelectOptions = {}, callback?: ResultCallback<boolean>): Promise<boolean> | void {
    const worker = operationWorker(async () => {
      const { aborted, query } = await this.baseQuery(options);
      if (aborted) return false;
      return query
        .select(this.database.raw('1 as ??', ['exists']))
        .first()
        .then((row) => row !== undefined);
    });
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  update(where: SQLWhere, values: SQLInputRow): Promise<number>;
  update(where: SQLWhere, values: SQLInputRow, callback: ResultCallback<number>): void;
  update(where: SQLWhere, values: SQLInputRow, callback?: ResultCallback<number>): Promise<number> | void {
    const worker = operationWorker(async () => {
      const normalized = normalizeInputRow(values, 'Updated field');
      const { aborted, query } = await this.baseQuery({ where });
      if (aborted) return 0;
      return query.update(normalized);
    });
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  delete(where: SQLWhere): Promise<number>;
  delete(where: SQLWhere, callback: ResultCallback<number>): void;
  delete(where: SQLWhere, callback?: ResultCallback<number>): Promise<number> | void {
    const worker = operationWorker(async () => {
      const { aborted, query } = await this.baseQuery({ where });
      if (aborted) return 0;
      return query.del();
    });
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  page(options?: SQLSelectOptions): Promise<SQLPage>;
  page(options: SQLSelectOptions | undefined, callback: ResultCallback<SQLPage>): void;
  page(options: SQLSelectOptions = {}, callback?: ResultCallback<SQLPage>): Promise<SQLPage> | void {
    const worker = operationWorker(() => Promise.all([this.selectOperation(options), this.countOperation({ ...options, limit: undefined, offset: undefined })]).then(([rows, totalRows]) => ({ offset: options.offset ?? 0, rows, totalRows })));
    return callback ? runWorker(worker, callback) : runWorker(worker);
  }

  private async baseQuery(options: SQLSelectOptions): Promise<{ aborted: boolean; query: QueryBuilder }> {
    const query = this.database<SQLRow, SQLRow[]>(this.table);
    for (const join of options.joins ?? []) {
      query.leftOuterJoin(requireIdentifier(join.table, 'Join table'), requireIdentifier(join.left, 'Join field'), '=', requireIdentifier(join.right, 'Join field'));
    }

    let aborted = appendPredicateGroup(query, { related: options.related, where: options.where }, this.database, this.table);
    if (options.ids) {
      if (options.ids.length === 0) aborted = true;
      else query.whereIn(`${this.table}.id`, options.ids.map(requireSQLValue));
    }
    appendOr(query, options.or, this.database, this.table);
    return { aborted, query };
  }

  private appendSelection(query: QueryBuilder, options: SQLSelectOptions): void {
    if (options.projections) {
      const projections = options.projections.map(({ as, column }) => {
        const reference = this.database.ref(requireIdentifier(column, 'Selected field'));
        return as ? reference.as(requireIdentifier(as, 'Selected alias')) : reference;
      });
      query.select(...projections);
      return;
    }

    if (options.columns) {
      query.select(...requireIdentifiers(options.columns, 'Selected field'));
      return;
    }

    query.select('*');
  }

  private async selectOperation(options: SQLSelectOptions): Promise<SQLRow[]> {
    if (options.unique && options.unique.length > 0) return this.selectUnique(options);

    const { aborted, query } = await this.baseQuery(options);
    if (aborted) return [];
    this.appendSelection(query, options);
    appendSortAndLimits(query, options);
    return query;
  }

  private async selectUnique(options: SQLSelectOptions): Promise<SQLRow[]> {
    if (options.projections) throw new Error('Unique queries require columns instead of projections');
    if (!options.columns || options.columns.length === 0) throw new Error('Unique queries require an explicit column list');

    const columns = requireIdentifiers(options.columns, 'Selected field');
    const unique = requireIdentifiers(options.unique ?? [], 'Unique field');
    if (columns.some((column) => column.includes('.')) || unique.some((column) => column.includes('.'))) {
      throw new Error('Unique query columns must be unqualified identifiers');
    }

    const { aborted, query } = await this.baseQuery(options);
    if (aborted) return [];

    if (columns.every((column) => unique.includes(column))) {
      query.distinct(...columns);
      appendSortAndLimits(query, options);
      return query;
    }

    const sorts = parseSorts(options.sort, ['id']);
    for (const { column } of sorts) {
      if (column.includes('.')) throw new Error(`Unique query sort field must be unqualified: ${column}`);
    }
    if (!sorts.some(({ column }) => column === 'id')) sorts.push({ column: 'id', order: 'asc' });

    const rankedColumns = [...new Set([...columns, ...sorts.map(({ column }) => column)])];
    query.select(...rankedColumns).rowNumber(RANK_COLUMN, function representativeOrder() {
      for (const { column, order } of sorts) this.orderBy(column, order);
      this.partitionBy(unique);
    });
    const ranked = query.as(RANKED_QUERY);
    const outer = this.database<SQLRow, SQLRow[]>(ranked)
      .select(...columns)
      .where(RANK_COLUMN, 1);
    appendSorts(outer, sorts);
    appendLimits(outer, options);
    return outer;
  }

  private async countOperation(options: SQLSelectOptions): Promise<number> {
    const { aborted, query } = await this.baseQuery(options);
    if (aborted) return 0;

    let countQuery: Knex.QueryBuilder;
    if (options.unique && options.unique.length > 0) {
      query.distinct(...requireIdentifiers(options.unique, 'Unique field'));
      countQuery = this.database.from(query.as(COUNT_QUERY)).count({ count: '*' });
    } else {
      countQuery = query.count({ count: '*' });
    }

    const rows: unknown = await countQuery;
    return normalizeCount(rows);
  }
}

import type Backbone from 'backbone';
import BackboneORM, { type CursorCallback, type CursorInstance, type CursorModelConstructor, type ModelConstructor, type Relation, type SchemaInstance } from 'backbone-orm';

import { requireIdentifier } from './internal/identifiers.ts';
import type SQLQuery from './internal/query.ts';
import { isSQLiteManyToManyRelation, requireSQLRelation, type SQLiteManyToManyRelation, type SQLRelationDialect } from './internal/relations.ts';
import { operationWorker, runWorker } from './internal/settle.ts';
import type { SQLPredicateGroup, SQLRelatedPredicate, SQLSelectOptions, SQLWhere } from './internal/types.ts';
import { nativeToAttributes } from './lib/nativeToAttributes.ts';

const SUPPORTED_CURSOR_KEYS = new Set(['$count', '$exists', '$ids', '$include', '$limit', '$offset', '$one', '$or', '$page', '$select', '$sort', '$unique', '$values', '$whitelist', '$zero']);

export type RelatedSQLQuery = (modelType: ModelConstructor<Backbone.Model>) => SQLQuery;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStringList(value: unknown, label: string): string[] {
  const values = Array.isArray(value) ? value : [value];
  if (!values.every((entry) => typeof entry === 'string')) throw new Error(`${label} must contain strings`);
  return values;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') throw new Error(`${label} must be a number`);
  return value;
}

function requireWhereList(value: unknown): SQLWhere[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error('$or must be an array of query objects');
  return value;
}

function compilePredicateGroup(where: SQLWhere, modelType: CursorModelConstructor, sqlQuery: SQLQuery, relatedSQLQuery: RelatedSQLQuery, columnAliases: Readonly<Record<string, string>>, dialect: SQLRelationDialect): SQLPredicateGroup {
  const local: SQLWhere = {};
  const related = new Map<string, SQLRelatedPredicate>();
  for (const [key, value] of Object.entries(where)) {
    if (!key.includes('.')) {
      const schema = requireSchema(modelType);
      const opposite = schema.reverseRelation(key);
      if (opposite?.join_table) {
        const relation = opposite.reverse_relation;
        if (!relation || !isSQLiteManyToManyRelation(relation)) throw new Error(`SQLite join-table query has no many-to-many relation: ${key}`);
        let predicate = related.get(`join:${relation.key}`);
        if (!predicate) {
          const joinQuery = relatedSQLQuery(relation.join_table);
          predicate = {
            innerColumn: relation.join_key,
            outerColumn: modelIDAttribute(modelType),
            table: joinQuery.table,
            where: {},
          };
          related.set(`join:${relation.key}`, predicate);
        }
        predicate.where[requireIdentifier(key, 'Join-table query field')] = value;
        continue;
      }
      local[columnAliases[key] ?? key] = value;
      continue;
    }

    const parts = key.split('.');
    const relationKey = parts[0];
    const fieldValue = parts[1];
    if (parts.length !== 2 || !relationKey || !fieldValue) throw new Error(`SQLite relation query supports one hop: ${key}`);
    const field = requireIdentifier(fieldValue, 'Related query field');
    let predicate = related.get(`relation:${relationKey}`);
    if (!predicate) {
      const relation = requireSQLRelation(requireSchema(modelType), relationKey, dialect);
      const relatedQuery = relatedSQLQuery(relation.reverse_model_type);
      if (relatedQuery.table === sqlQuery.table) throw new Error(`SQLite self-relation predicates are not implemented: ${relationKey}`);

      if (isSQLiteManyToManyRelation(relation)) {
        const joinQuery = relatedSQLQuery(relation.join_table);
        predicate = {
          innerColumn: relation.join_key,
          outerColumn: modelIDAttribute(modelType),
          table: joinQuery.table,
          through: {
            joinColumn: relation.reverse_relation.join_key,
            relatedColumn: modelIDAttribute(relation.reverse_model_type),
            table: relatedQuery.table,
          },
          where: {},
        };
      } else if (relation.type === 'belongsTo') {
        predicate = {
          innerColumn: modelIDAttribute(relation.reverse_model_type),
          outerColumn: relation.foreign_key,
          table: relatedQuery.table,
          where: {},
        };
      } else {
        const reverse = relation.reverse_relation;
        if (!reverse) throw new Error(`SQLite ${relation.type} relation has no reverse relation: ${relationKey}`);
        predicate = {
          innerColumn: reverse.foreign_key,
          outerColumn: modelIDAttribute(modelType),
          table: relatedQuery.table,
          where: {},
        };
      }
      related.set(`relation:${relationKey}`, predicate);
    }
    predicate.where[field] = value;
  }
  return { related: [...related.values()], where: local };
}

function selectOptions(find: Record<string, unknown>, cursor: Record<string, unknown>, modelType: CursorModelConstructor, sqlQuery: SQLQuery, relatedSQLQuery: RelatedSQLQuery, columnAliases: Readonly<Record<string, string>>, dialect: SQLRelationDialect): SQLSelectOptions {
  for (const key of Object.keys(cursor)) {
    if (!SUPPORTED_CURSOR_KEYS.has(key)) throw new Error(`SQLite cursor control is not implemented: ${key}`);
  }

  const predicates = compilePredicateGroup(find, modelType, sqlQuery, relatedSQLQuery, columnAliases, dialect);
  const options: SQLSelectOptions = { related: predicates.related, where: predicates.where };
  if (cursor.$ids !== undefined) {
    if (!Array.isArray(cursor.$ids)) throw new Error('$ids must be an array');
    options.ids = cursor.$ids;
  }
  if (cursor.$limit !== undefined) options.limit = requireNumber(cursor.$limit, '$limit');
  if (cursor.$offset !== undefined) options.offset = requireNumber(cursor.$offset, '$offset');
  if (cursor.$or !== undefined) {
    options.or = requireWhereList(cursor.$or).map((alternative) => compilePredicateGroup(alternative, modelType, sqlQuery, relatedSQLQuery, columnAliases, dialect));
  }
  if (cursor.$select !== undefined) options.columns = requireStringList(cursor.$select, '$select');
  else if (cursor.$values !== undefined) options.columns = requireStringList(cursor.$values, '$values');
  else if (cursor.$unique !== undefined) options.columns = requireSchema(modelType).columns();

  if (cursor.$include !== undefined && options.columns) {
    const schema = requireSchema(modelType);
    const columns = new Set(options.columns);
    columns.add(modelIDAttribute(modelType));
    for (const key of requireIncludeKeys(cursor.$include)) {
      const relation = requireSQLRelation(schema, key, dialect);
      if (relation.type === 'belongsTo') columns.add(relation.foreign_key);
    }
    options.columns = [...columns];
  }
  if (cursor.$sort !== undefined) {
    options.sort = typeof cursor.$sort === 'string' ? cursor.$sort : requireStringList(cursor.$sort, '$sort');
  }
  if (cursor.$unique !== undefined) options.unique = requireStringList(cursor.$unique, '$unique');
  return options;
}

function requireIncludeKeys(value: unknown): string[] {
  const keys = requireStringList(value, '$include');
  if (keys.length === 0) throw new Error('$include must contain at least one relation');
  return keys;
}

function requireSchema(modelType: CursorModelConstructor): SchemaInstance {
  const schema = modelType.schema?.();
  if (!schema) throw new Error('SQLite relation operation requires the configured Backbone ORM schema control');
  return schema;
}

function modelIDAttribute(modelType: ModelConstructor<Backbone.Model>): string {
  return new modelType().idAttribute;
}

export default class SQLiteAdapterCursor extends BackboneORM.Cursor {
  declare readonly sqlQuery: SQLQuery;

  private readonly relatedSQLQuery: RelatedSQLQuery;
  private readonly dialect: SQLRelationDialect;
  private readonly columnAliases: Readonly<Record<string, string>>;

  constructor(query: unknown, sqlQuery: SQLQuery, modelType: CursorModelConstructor, relatedSQLQuery: RelatedSQLQuery, columnAliases: Readonly<Record<string, string>> = {}, dialect: SQLRelationDialect = 'SQLite') {
    super(query, { model_type: modelType, sqlQuery });
    this.relatedSQLQuery = relatedSQLQuery;
    this.dialect = dialect;
    this.columnAliases = columnAliases;
  }

  queryToJSON(callback: CursorCallback): void {
    const worker = operationWorker(async () => {
      if (this.hasCursorQuery('$zero')) return this.hasCursorQuery('$one') ? null : [];

      if (this.dialect === 'PostgreSQL') {
        this.relatedSQLQuery(this.model_type);
        if (this.hasCursorQuery('$include')) {
          const schema = requireSchema(this.model_type);
          for (const key of requireIncludeKeys(this._cursor.$include)) {
            const relation = requireSQLRelation(schema, key, this.dialect);
            this.relatedSQLQuery(relation.reverse_model_type);
            if (isSQLiteManyToManyRelation(relation)) this.relatedSQLQuery(relation.join_table);
          }
        }
      }

      const options = selectOptions(this._find, this._cursor, this.model_type, this.sqlQuery, this.relatedSQLQuery, this.columnAliases, this.dialect);
      if (this.hasCursorQuery('$count')) return this.sqlQuery.count(options);
      if (this.hasCursorQuery('$exists')) return this.sqlQuery.exists(options);

      if (this.hasCursorQuery('$page')) {
        const page = await this.sqlQuery.page(options);
        const rows = await this.includeRelations(page.rows);
        return {
          offset: page.offset,
          rows: this.selectIncludedResults(rows),
          total_rows: page.totalRows,
        };
      }

      if (this.hasCursorQuery('$one')) options.limit = 1;
      const rows = await this.sqlQuery.select(options);
      return this.selectIncludedResults(await this.includeRelations(rows));
    });
    runWorker(worker, (error, value) => {
      callback(error, value);
    });
  }

  private async includeRelations(rows: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
    if (!this.hasCursorQuery('$include')) return rows;

    const schema = requireSchema(this.model_type);
    const includedRows = rows.map((row) => ({ ...row }));
    for (const key of requireIncludeKeys(this._cursor.$include)) {
      const relation = requireSQLRelation(schema, key, this.dialect);
      if (relation.type === 'belongsTo') await this.includeBelongsTo(includedRows, key, relation);
      else if (relation.type === 'hasOne') await this.includeHasOne(includedRows, key, relation);
      else if (isSQLiteManyToManyRelation(relation)) await this.includeManyToMany(includedRows, key, relation);
      else await this.includeHasMany(includedRows, key, relation);
    }
    return includedRows;
  }

  private selectIncludedResults(rows: Array<Record<string, unknown>>): unknown {
    const schema = requireSchema(this.model_type);
    for (const row of rows) nativeToAttributes(row, schema);
    const selected: unknown = this.selectResults(rows);
    if (!this.hasCursorQuery('$include') || this.hasCursorQuery('$values')) return selected;

    const includeKeys = requireIncludeKeys(this._cursor.$include);
    const mergeIncludes = (target: unknown, source: Record<string, unknown> | undefined): Record<string, unknown> => {
      if (!isRecord(target) || !source) throw new Error('SQLite $include requires object-valued cursor results');
      const result = { ...target };
      for (const key of includeKeys) result[key] = source[key];
      return result;
    };

    if (this.hasCursorQuery('$page') || !this.hasCursorQuery('$one')) {
      if (!Array.isArray(selected)) throw new Error('SQLite $include requires array cursor results');
      return selected.map((result, index) => mergeIncludes(result, rows[index]));
    }
    if (selected === null) return null;
    return mergeIncludes(selected, rows[0]);
  }

  private async includeBelongsTo(rows: Array<Record<string, unknown>>, key: string, relation: Relation): Promise<void> {
    const foreignIDs = rows.map((row) => row[relation.foreign_key]).filter((value) => value !== null && value !== undefined);
    if (foreignIDs.length === 0) {
      for (const row of rows) row[key] = null;
      return;
    }

    const idAttribute = modelIDAttribute(relation.reverse_model_type);
    const relatedRows = await this.selectRelated(relation.reverse_model_type, { where: { [idAttribute]: { $in: foreignIDs } } });
    const relatedByID = new Map<unknown, Record<string, unknown>>();
    for (const relatedRow of relatedRows) relatedByID.set(relatedRow[idAttribute], relatedRow);
    for (const row of rows) row[key] = relatedByID.get(row[relation.foreign_key]) ?? null;
  }

  private async includeHasMany(rows: Array<Record<string, unknown>>, key: string, relation: Relation): Promise<void> {
    const { idAttribute, relatedByParentID } = await this.reverseRelatedRows(rows, key, relation);
    for (const row of rows) row[key] = relatedByParentID.get(row[idAttribute]) ?? [];
  }

  private async includeHasOne(rows: Array<Record<string, unknown>>, key: string, relation: Relation): Promise<void> {
    const { idAttribute, relatedByParentID } = await this.reverseRelatedRows(rows, key, relation);
    for (const row of rows) {
      const relatedRows = relatedByParentID.get(row[idAttribute]);
      row[key] = relatedRows?.[relatedRows.length - 1] ?? null;
    }
  }

  private async includeManyToMany(rows: Array<Record<string, unknown>>, key: string, relation: SQLiteManyToManyRelation): Promise<void> {
    const idAttribute = modelIDAttribute(this.model_type);
    const parentIDs = rows.map((row) => row[idAttribute]).filter((value) => value !== null && value !== undefined);
    const relatedByParentID = new Map<unknown, Array<Record<string, unknown>>>();
    if (parentIDs.length > 0) {
      const joinRows = await this.selectRelated(relation.join_table, { where: { [relation.join_key]: { $in: parentIDs } } });
      const relatedIDs = joinRows.map((row) => row[relation.reverse_relation.join_key]).filter((value) => value !== null && value !== undefined);
      const relatedIDAttribute = modelIDAttribute(relation.reverse_model_type);
      const relatedRows = relatedIDs.length > 0 ? await this.selectRelated(relation.reverse_model_type, { where: { [relatedIDAttribute]: { $in: relatedIDs } } }) : [];
      const relatedByID = new Map<unknown, Record<string, unknown>>();
      for (const relatedRow of relatedRows) relatedByID.set(relatedRow[relatedIDAttribute], relatedRow);

      const seenByParentID = new Map<unknown, Set<unknown>>();
      for (const joinRow of joinRows) {
        const parentID = joinRow[relation.join_key];
        const relatedID = joinRow[relation.reverse_relation.join_key];
        const relatedRow = relatedByID.get(relatedID);
        if (!relatedRow) continue;
        let seen = seenByParentID.get(parentID);
        if (!seen) {
          seen = new Set();
          seenByParentID.set(parentID, seen);
        }
        if (seen.has(relatedID)) continue;
        seen.add(relatedID);
        const grouped = relatedByParentID.get(parentID);
        if (grouped) grouped.push(relatedRow);
        else relatedByParentID.set(parentID, [relatedRow]);
      }
    }
    for (const row of rows) row[key] = relatedByParentID.get(row[idAttribute]) ?? [];
  }

  private async reverseRelatedRows(rows: Array<Record<string, unknown>>, key: string, relation: Relation): Promise<{ idAttribute: string; relatedByParentID: Map<unknown, Array<Record<string, unknown>>> }> {
    const reverse = relation.reverse_relation;
    if (!reverse) throw new Error(`SQLite ${relation.type} relation has no reverse relation: ${key}`);

    const idAttribute = modelIDAttribute(this.model_type);
    const parentIDs = rows.map((row) => row[idAttribute]).filter((value) => value !== null && value !== undefined);
    const relatedByParentID = new Map<unknown, Array<Record<string, unknown>>>();
    if (parentIDs.length > 0) {
      const relatedRows = await this.selectRelated(relation.reverse_model_type, { where: { [reverse.foreign_key]: { $in: parentIDs } } });
      for (const relatedRow of relatedRows) {
        const parentID = relatedRow[reverse.foreign_key];
        const grouped = relatedByParentID.get(parentID);
        if (grouped) grouped.push(relatedRow);
        else relatedByParentID.set(parentID, [relatedRow]);
      }
    }
    return { idAttribute, relatedByParentID };
  }

  private async selectRelated(modelType: CursorModelConstructor, options: SQLSelectOptions): Promise<Array<Record<string, unknown>>> {
    const rows = await this.relatedSQLQuery(modelType).select(options);
    const schema = requireSchema(modelType);
    for (const row of rows) nativeToAttributes(row, schema);
    return rows;
  }
}

const cursorContract: CursorInstance = SQLiteAdapterCursor.prototype;
void cursorContract;

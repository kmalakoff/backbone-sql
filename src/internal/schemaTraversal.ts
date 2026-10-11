import type { SchemaInstance } from 'backbone-orm';

import type { SQLSchemaControlOptions } from '../types.ts';
import { requireOpenSQLConnection, scheduleSchemaOperation } from './connection.ts';
import { ensureConfiguredTable } from './databaseControl.ts';
import { type default as SQLSchema, validateDefinitions } from './schema.ts';
import type { SQLColumnDefinition, SQLConnection } from './types.ts';

export type SchemaTraversalMode = 'ensure' | 'reset';
export type SchemaTraversal = (mode: SchemaTraversalMode, options: SQLSchemaControlOptions) => Promise<void>;

export interface SQLiteSchemaNode {
  definitions: readonly SQLColumnDefinition[];
  joins: SQLiteSchemaNode[];
  ormSchema?: Pick<SchemaInstance, 'fields' | 'relations'>;
  schema: SQLSchema;
  verify(): void;
}

export function runSchemaTraversal(connection: SQLConnection, mode: SchemaTraversalMode, options: SQLSchemaControlOptions, graph: () => SQLiteSchemaNode): Promise<void> {
  return scheduleSchemaOperation(connection, async () => {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('SQLite schema options must be an object');
    if (options.verbose !== undefined && typeof options.verbose !== 'boolean') throw new Error('SQLite schema verbose must be a boolean');
    const root = graph();
    const preflighted = new Set<SQLiteSchemaNode>();
    const preflight = (node: SQLiteSchemaNode): void => {
      if (preflighted.has(node)) return;
      preflighted.add(node);
      node.verify();
      if (node.definitions.length === 0) throw new Error(`SQLite ${mode}Schema requires column definitions: ${node.schema.table}`);
      validateDefinitions(node.definitions);
      for (const join of node.joins) preflight(join);
    };
    preflight(root);

    const resetting = new Set<SQLiteSchemaNode>();
    const resetVisited = new Set<SQLiteSchemaNode>();
    const verify = (): void => {
      requireOpenSQLConnection(connection);
      for (const node of preflighted) node.verify();
    };
    const ensure = async (node: SQLiteSchemaNode, phaseVisited: Set<SQLiteSchemaNode>, active: Set<SQLiteSchemaNode>): Promise<void> => {
      if (phaseVisited.has(node) || active.has(node) || resetting.has(node)) return;
      phaseVisited.add(node);
      active.add(node);
      try {
        verify();
        await ensureConfiguredTable(node.schema, node.definitions, node === root ? options : {}, node.ormSchema, verify);
        for (const join of node.joins) await ensure(join, phaseVisited, active);
      } finally {
        active.delete(node);
      }
    };
    const reset = async (node: SQLiteSchemaNode): Promise<void> => {
      if (resetVisited.has(node) || resetting.has(node)) return;
      resetVisited.add(node);
      resetting.add(node);
      try {
        verify();
        await node.schema.dropOwnedTableIfExists(verify);
        for (const join of node.joins) await reset(join);
        resetting.delete(node);
        // Each post-reset ensure phase retains parent-then-pivot checks without repeating drops.
        await ensure(node, new Set(), new Set());
      } finally {
        resetting.delete(node);
      }
    };

    if (mode === 'reset') await reset(root);
    else await ensure(root, new Set(), new Set());
  });
}

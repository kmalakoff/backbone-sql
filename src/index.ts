import BackboneORM from 'backbone-orm';

import sync from './sync.ts';

export const configure = BackboneORM.configure;
export const Backbone = BackboneORM.Backbone;
export const _ = BackboneORM._;

const ormModules = BackboneORM.modules;
if (typeof ormModules !== 'object' || ormModules === null) throw new Error('backbone-orm modules must be an object');

export const modules: Record<string, unknown> = {
  ...ormModules,
  'backbone-orm': BackboneORM,
};

export { sync };

const BackboneSQL = {
  _,
  Backbone,
  configure,
  modules,
  sync,
};

export default BackboneSQL;
export type { SQLCapabilities, SQLSyncFactory, SQLSyncOptions } from './sync.ts';
export type { PostgreSQLDatabaseControl, SQLiteDatabaseControl, SQLSchemaControlOptions } from './types.ts';
export type { ErrorCallback, OwnedPostgreSQLConnection, OwnedSQLConnection, ResultCallback, SQLConnection } from './internal/types.ts';

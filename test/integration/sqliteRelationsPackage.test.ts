import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'assert';
import BackboneORM from 'backbone-orm';
import BackboneSQL from 'backbone-sql';
import { safeRmSync } from 'fs-remove-compat';

const require = createRequire(import.meta.url);
const CJSBackboneSQL: typeof BackboneSQL = require('backbone-sql');

type Callback = (error: Error | null, value?: unknown) => void;

interface ParentAttributes extends Backbone.ObjectHash {
  children?: Child[];
  id?: number;
  name?: string;
}

interface ChildAttributes extends Backbone.ObjectHash {
  id?: number;
  parent?: Parent;
  title?: string;
}

class Parent extends BackboneSQL.Backbone.Model<ParentAttributes> {
  urlRoot = 'sqlite3:///relation_parents';

  schema(): Record<string, unknown> {
    return {
      children: () => ['hasMany', Child, { as: 'parent' }],
      name: ['String', { nullable: false, unique: true }],
    };
  }
}

class Child extends BackboneSQL.Backbone.Model<ChildAttributes> {
  urlRoot = 'sqlite3:///relation_children';

  schema(): Record<string, unknown> {
    return {
      parent: () => ['belongsTo', Parent, { as: 'children' }],
      title: ['String', { nullable: false, unique: true }],
    };
  }
}

interface CachedParentAttributes extends Backbone.ObjectHash {
  children?: CachedChild[];
  id?: number;
  name?: string;
}

interface CachedChildAttributes extends Backbone.ObjectHash {
  id?: number;
  parent?: CachedParent;
  title?: string;
}

class CachedParent extends BackboneSQL.Backbone.Model<CachedParentAttributes> {
  urlRoot = 'sqlite3:///cached_relation_parents';

  schema(): Record<string, unknown> {
    return {
      children: () => ['hasMany', CachedChild, { as: 'parent' }],
      name: ['String', { nullable: false }],
    };
  }
}

class CachedChild extends BackboneSQL.Backbone.Model<CachedChildAttributes> {
  urlRoot = 'sqlite3:///cached_relation_children';

  schema(): Record<string, unknown> {
    return {
      parent: () => ['belongsTo', CachedParent, { as: 'children' }],
      title: ['String', { nullable: false }],
    };
  }
}

interface HasOneOwnerAttributes extends Backbone.ObjectHash {
  id?: number;
  name?: string;
  profile?: HasOneProfile | null;
}

interface HasOneProfileAttributes extends Backbone.ObjectHash {
  id?: number;
  owner?: HasOneOwner | null;
  title?: string;
}

class HasOneOwner extends BackboneSQL.Backbone.Model<HasOneOwnerAttributes> {
  urlRoot = 'sqlite3:///has_one_owners';

  schema(): Record<string, unknown> {
    return {
      name: ['String', { nullable: false }],
      profile: () => ['hasOne', HasOneProfile, { as: 'owner' }],
    };
  }
}

class HasOneProfile extends BackboneSQL.Backbone.Model<HasOneProfileAttributes> {
  urlRoot = 'sqlite3:///has_one_profiles';

  schema(): Record<string, unknown> {
    return {
      owner: () => ['belongsTo', HasOneOwner, { as: 'profile' }],
      title: ['String', { nullable: false }],
    };
  }
}

interface CachedHasOneOwnerAttributes extends Backbone.ObjectHash {
  id?: number;
  name?: string;
  profile?: CachedHasOneProfile | null;
}

interface CachedHasOneProfileAttributes extends Backbone.ObjectHash {
  id?: number;
  owner?: CachedHasOneOwner | null;
  title?: string;
}

class CachedHasOneOwner extends BackboneSQL.Backbone.Model<CachedHasOneOwnerAttributes> {
  urlRoot = 'sqlite3:///cached_has_one_owners';

  schema(): Record<string, unknown> {
    return {
      name: ['String', { nullable: false }],
      profile: () => ['hasOne', CachedHasOneProfile, { as: 'owner' }],
    };
  }
}

class CachedHasOneProfile extends BackboneSQL.Backbone.Model<CachedHasOneProfileAttributes> {
  urlRoot = 'sqlite3:///cached_has_one_profiles';

  schema(): Record<string, unknown> {
    return {
      owner: () => ['belongsTo', CachedHasOneOwner, { as: 'profile' }],
      title: ['String', { nullable: false }],
    };
  }
}

interface PredicateParentAttributes extends Backbone.ObjectHash {
  active?: boolean;
  children?: PredicateChild[];
  id?: number;
  name?: string;
  profile?: PredicateProfile | null;
}

interface PredicateChildAttributes extends Backbone.ObjectHash {
  id?: number;
  parent?: PredicateParent | null;
  score?: number;
  title?: string;
}

interface PredicateProfileAttributes extends Backbone.ObjectHash {
  id?: number;
  label?: string;
  owner?: PredicateParent | null;
}

class PredicateParent extends BackboneSQL.Backbone.Model<PredicateParentAttributes> {
  urlRoot = 'sqlite3:///predicate_parents';

  schema(): Record<string, unknown> {
    return {
      active: ['Boolean', { nullable: false }],
      children: () => ['hasMany', PredicateChild, { as: 'parent' }],
      name: ['String', { nullable: false, unique: true }],
      profile: () => ['hasOne', PredicateProfile, { as: 'owner' }],
    };
  }
}

class PredicateChild extends BackboneSQL.Backbone.Model<PredicateChildAttributes> {
  urlRoot = 'sqlite3:///predicate_children';

  schema(): Record<string, unknown> {
    return {
      parent: () => ['belongsTo', PredicateParent, { as: 'children' }],
      score: ['Integer', { nullable: false }],
      title: ['String', { nullable: false, unique: true }],
    };
  }
}

class PredicateProfile extends BackboneSQL.Backbone.Model<PredicateProfileAttributes> {
  urlRoot = 'sqlite3:///predicate_profiles';

  schema(): Record<string, unknown> {
    return {
      label: ['String', { nullable: false }],
      owner: () => ['belongsTo', PredicateParent, { as: 'profile' }],
    };
  }
}

interface ProjectionParentAttributes extends Backbone.ObjectHash {
  children?: ProjectionChild[];
  group?: string;
  id?: number;
  name?: string;
  priority?: number;
  profile?: ProjectionProfile | null;
  tags?: ProjectionTag[];
}

interface ProjectionChildAttributes extends Backbone.ObjectHash {
  id?: number;
  parent?: ProjectionParent | null;
  title?: string;
}

interface ProjectionProfileAttributes extends Backbone.ObjectHash {
  id?: number;
  label?: string;
  owner?: ProjectionParent | null;
}

interface ProjectionTagAttributes extends Backbone.ObjectHash {
  id?: number;
  label?: string;
  parents?: ProjectionParent[];
}

class ProjectionParent extends BackboneSQL.Backbone.Model<ProjectionParentAttributes> {
  urlRoot = 'sqlite3:///projection_parents';

  schema(): Record<string, unknown> {
    return {
      children: () => ['hasMany', ProjectionChild, { as: 'parent' }],
      group: ['String', { nullable: false }],
      name: ['String', { nullable: false }],
      priority: ['Integer', { nullable: false }],
      profile: () => ['hasOne', ProjectionProfile, { as: 'owner' }],
      tags: () => ['hasMany', ProjectionTag, { as: 'parents' }],
    };
  }
}

class ProjectionChild extends BackboneSQL.Backbone.Model<ProjectionChildAttributes> {
  urlRoot = 'sqlite3:///projection_children';

  schema(): Record<string, unknown> {
    return {
      parent: () => ['belongsTo', ProjectionParent, { as: 'children' }],
      title: ['String', { nullable: false }],
    };
  }
}

class ProjectionProfile extends BackboneSQL.Backbone.Model<ProjectionProfileAttributes> {
  urlRoot = 'sqlite3:///projection_profiles';

  schema(): Record<string, unknown> {
    return {
      label: ['String', { nullable: false }],
      owner: () => ['belongsTo', ProjectionParent, { as: 'profile' }],
    };
  }
}

class ProjectionTag extends BackboneSQL.Backbone.Model<ProjectionTagAttributes> {
  urlRoot = 'sqlite3:///projection_tags';

  schema(): Record<string, unknown> {
    return {
      label: ['String', { nullable: false }],
      parents: () => ['hasMany', ProjectionParent, { as: 'tags' }],
    };
  }
}

interface ManyStudentAttributes extends Backbone.ObjectHash {
  courses?: ManyCourse[];
  id?: number;
  name?: string;
}

interface ManyCourseAttributes extends Backbone.ObjectHash {
  id?: number;
  students?: ManyStudent[];
  title?: string;
}

class ManyStudent extends BackboneSQL.Backbone.Model<ManyStudentAttributes> {
  urlRoot = 'sqlite3:///many_students';

  schema(): Record<string, unknown> {
    return {
      courses: () => ['hasMany', ManyCourse, { as: 'students' }],
      name: ['String', { nullable: false }],
    };
  }
}

class ManyCourse extends BackboneSQL.Backbone.Model<ManyCourseAttributes> {
  urlRoot = 'sqlite3:///many_courses';

  schema(): Record<string, unknown> {
    return {
      students: () => ['hasMany', ManyStudent, { as: 'courses' }],
      title: ['String', { nullable: false }],
    };
  }
}

interface CustomManyStudentAttributes extends Backbone.ObjectHash {
  id?: number;
  name?: string;
  subjects?: CustomManyCourse[];
}

interface CustomManyCourseAttributes extends Backbone.ObjectHash {
  id?: number;
  learners?: CustomManyStudent[];
  level?: number;
  title?: string;
  topic?: string;
}

class CustomManyStudent extends BackboneSQL.Backbone.Model<CustomManyStudentAttributes> {
  urlRoot = 'sqlite3:///custom_many_students';

  schema(): Record<string, unknown> {
    return {
      name: ['String', { nullable: false }],
      subjects: () => ['hasMany', CustomManyCourse, { as: 'learners', foreign_key: 'student_relation_alias', join_key: 'pivot_student_id' }],
    };
  }
}

class CustomManyCourse extends BackboneSQL.Backbone.Model<CustomManyCourseAttributes> {
  urlRoot = 'sqlite3:///custom_many_courses';

  schema(): Record<string, unknown> {
    return {
      learners: () => ['hasMany', CustomManyStudent, { as: 'subjects', foreign_key: 'course_relation_alias', join_key: 'pivot_course_id' }],
      level: ['Integer', { nullable: false }],
      title: ['String', { nullable: false }],
      topic: ['String', { nullable: false }],
    };
  }
}

interface CachedManyStudentAttributes extends Backbone.ObjectHash {
  courses?: CachedManyCourse[];
  id?: number;
  name?: string;
}

interface CachedManyCourseAttributes extends Backbone.ObjectHash {
  id?: number;
  students?: CachedManyStudent[];
  title?: string;
}

class CachedManyStudent extends BackboneSQL.Backbone.Model<CachedManyStudentAttributes> {
  urlRoot = 'sqlite3:///cached_many_students';

  schema(): Record<string, unknown> {
    return {
      courses: () => ['hasMany', CachedManyCourse, { as: 'students' }],
      name: ['String', { nullable: false }],
    };
  }
}

class CachedManyCourse extends BackboneSQL.Backbone.Model<CachedManyCourseAttributes> {
  urlRoot = 'sqlite3:///cached_many_courses';

  schema(): Record<string, unknown> {
    return {
      students: () => ['hasMany', CachedManyStudent, { as: 'courses' }],
      title: ['String', { nullable: false }],
    };
  }
}

function callbackResult(invoke: (callback: Callback) => unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    invoke((error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function callbackCompletion(invoke: (callback: Callback) => unknown): Promise<void> {
  return callbackResult(invoke).then(() => undefined);
}

function callMethod(host: object, name: string, arguments_: readonly unknown[]): unknown {
  const method: unknown = Reflect.get(host, name);
  if (typeof method !== 'function') throw new Error(`Missing ORM method: ${name}`);
  return Reflect.apply(method, host, arguments_);
}

function callStatic(host: object, name: string, arguments_: readonly unknown[]): unknown {
  return callMethod(host, name, arguments_);
}

function callControl(host: object, method: string, ...arguments_: unknown[]): unknown {
  const syncMethod: unknown = Reflect.get(Reflect.get(host, 'prototype'), 'sync');
  if (typeof syncMethod !== 'function') throw new Error('Missing configured model sync');
  return Reflect.apply(syncMethod, host, [method, ...arguments_]);
}

function save(model: Backbone.Model): Promise<void> {
  return callbackCompletion((callback) => callMethod(model, 'save', [callback]));
}

function fetch(model: Backbone.Model): Promise<void> {
  return callbackCompletion((callback) => callMethod(model, 'fetch', [callback]));
}

function patchRemove(model: Backbone.Model, key: string): Promise<void> {
  return callbackCompletion((callback) => callMethod(model, 'patchRemove', [key, callback]));
}

function patchAdd(model: Backbone.Model, key: string, relatedModel: Backbone.Model): Promise<void> {
  return callbackCompletion((callback) => callMethod(model, 'patchAdd', [key, relatedModel, callback]));
}

function patchRemoveRelated(model: Backbone.Model, key: string, relatedModel: Backbone.Model): Promise<void> {
  return callbackCompletion((callback) => callMethod(model, 'patchRemove', [key, relatedModel, callback]));
}

function destroyModel(model: Backbone.Model): Promise<void> {
  return callbackCompletion((callback) => callMethod(model, 'destroy', [callback]));
}

function related(model: Backbone.Model, key: string): Promise<unknown> {
  return callbackResult((callback) => callMethod(model, 'get', [key, callback]));
}

function cursorResult(modelType: object, query: Record<string, unknown>, method = 'toJSON'): Promise<unknown> {
  const cursor = callStatic(modelType, 'cursor', [query]);
  if (typeof cursor !== 'object' || cursor === null) throw new Error('ORM cursor was not returned');
  return callbackResult((callback) => callMethod(cursor, method, [callback]));
}

function models(value: unknown): Backbone.Model[] {
  if (!Array.isArray(value) || !value.every((entry) => entry instanceof BackboneSQL.Backbone.Model)) {
    throw new Error('Expected an array of Backbone models');
  }
  return value;
}

function numericID(model: Backbone.Model): number {
  if (typeof model.id !== 'number') throw new Error('Expected a generated numeric SQLite model id');
  return model.id;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))) {
    throw new Error('Expected an array of SQLite rows');
  }
  return value;
}

function row(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a SQLite row');
  return value as Record<string, unknown>;
}

function joinTable(modelType: object, key: string): object {
  const relation = callStatic(modelType, 'relation', [key]);
  if (typeof relation !== 'object' || relation === null) throw new Error(`Missing relation: ${key}`);
  const table: unknown = Reflect.get(relation, 'join_table');
  if (typeof table !== 'function') throw new Error(`Missing join table: ${key}`);
  return table;
}

async function closeModels(...modelTypes: object[]): Promise<void> {
  const results = await Promise.allSettled(modelTypes.map((modelType) => Promise.resolve(callControl(modelType, 'closeConnection'))));
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }
}

function schemaControl(modelType: object): object {
  const control = callStatic(modelType, 'db', []);
  if (typeof control !== 'object' || control === null) throw new Error('Expected public database controls');
  return control;
}

function schemaDatabase(control: object): object {
  const connection: unknown = Reflect.get(control, 'connection');
  if (typeof connection !== 'object' || connection === null) throw new Error('Expected public SQLite connection');
  const database = callMethod(connection, 'knex', []);
  if (typeof database !== 'function') throw new Error('Expected real Knex database');
  return database;
}

async function schemaOutcome(control: object, method: 'ensureSchema' | 'resetSchema', options?: { verbose?: boolean }, onNotification?: () => void): Promise<Error | null> {
  let calls = 0;
  const error = await new Promise<Error | null>((resolve) => {
    const callback = (...arguments_: [error?: Error | null]): void => {
      calls += 1;
      assert.strictEqual(arguments_.length, 1);
      onNotification?.();
      resolve(arguments_[0] ?? null);
    };
    const returned = callMethod(control, method, options === undefined ? [callback] : [options, callback]);
    assert.strictEqual(returned, undefined);
    assert.strictEqual(calls, 0);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.strictEqual(calls, 1);
  return error;
}

function throwRepeatedSQLiteFailures(failures: unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    const aggregateConstructor: unknown = Reflect.get(globalThis, 'AggregateError');
    if (typeof aggregateConstructor !== 'function') throw new Error('SQLite repeat fixture requires native AggregateError');
    throw Reflect.construct(aggregateConstructor, [failures, message]);
  }
}

async function withRepeatedSQLiteFixture(cache: boolean, body: (fixture: { filename: string; url: (table: string) => string; admitted: () => void; released: (connection: unknown) => void }) => Promise<void>): Promise<void> {
  const token = randomUUID();
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', token);
  const filename = path.join(root, 'database.sqlite3');
  const acquired = new Map<unknown, string>();
  const released = new Set<unknown>();
  const admitted = (): void => {
    BackboneORM.ConnectionPool.forEach((connection, key) => {
      if (typeof key === 'string' && typeof connection === 'object' && connection !== null && Reflect.get(connection, 'filename') === filename) acquired.set(connection, key);
    });
  };
  let failure: { value: unknown } | undefined;
  let cacheConfigured = false;
  try {
    mkdirSync(root, { recursive: true });
    cacheConfigured = true;
    BackboneSQL.configure({ model_cache: { enabled: cache, max: 100 } });
    await body({
      filename,
      url: (table) => `sqlite3://repeat-${token}/${table}`,
      admitted,
      released: (connection) => {
        assert.ok(acquired.has(connection));
        released.add(connection);
      },
    });
  } catch (value) {
    failure = { value };
  }
  const failures: unknown[] = failure ? [failure.value] : [];
  let closed = true;
  for (const [connection, key] of acquired) {
    if (released.has(connection)) continue;
    try {
      if (BackboneORM.ConnectionPool.get(key) !== connection) throw new Error(`Repeat fixture pool handle replaced; retain ${root}`);
      await BackboneORM.ConnectionPool.dispose(key);
    } catch (error) {
      closed = false;
      failures.push(error);
    }
  }
  if (cacheConfigured) {
    try {
      BackboneSQL.configure({ model_cache: { enabled: false } });
    } catch (error) {
      failures.push(error);
    }
  }
  if (closed) {
    try {
      safeRmSync(root);
    } catch (error) {
      failures.push(error);
    }
  }
  throwRepeatedSQLiteFailures(failures, `SQLite repeat fixture and cleanup failed; scratch ${root}`);
}

describe('SQLite registered schema authority', () => {
  for (const format of ['cjs', 'esm'] as const) {
    const entry = format === 'cjs' ? CJSBackboneSQL : BackboneSQL;
    const other = format === 'cjs' ? BackboneSQL : CJSBackboneSQL;
    for (const cache of [false, true]) {
      it(`retains live inverse schema after first configuration from ${format} with cache=${cache}`, async () => {
        await withRepeatedSQLiteFixture(cache, async (fixture) => {
          class AuthorityChild extends BackboneSQL.Backbone.Model {
            urlRoot = fixture.url('authority_children');
            schema(): object {
              return { title: 'String' };
            }
          }
          class AuthorityParent extends BackboneSQL.Backbone.Model {
            urlRoot = fixture.url('authority_parents');
            schema(): object {
              return { name: 'String', primary: () => ['belongsTo', AuthorityChild], children: () => ['hasMany', AuthorityChild, { as: 'parent' }] };
            }
          }
          try {
            entry.sync(AuthorityChild, { filename: fixture.filename });
          } finally {
            fixture.admitted();
          }
          const childSchema = callControl(AuthorityChild, 'schema');
          const connection = Reflect.get(schemaControl(AuthorityChild), 'connection');
          assert.strictEqual(await schemaOutcome(schemaControl(AuthorityChild), 'ensureSchema'), null);
          const child = new AuthorityChild({ title: 'before inverse' });
          const survivor = new AuthorityChild({ title: 'unrelated' });
          await save(child);
          await save(survivor);
          try {
            other.sync(AuthorityParent, { filename: fixture.filename });
          } finally {
            fixture.admitted();
          }
          const parentSchema = callControl(AuthorityParent, 'schema');
          for (const api of [entry, other]) {
            assert.ok(api.sync(AuthorityChild, { filename: fixture.filename }) === AuthorityChild.prototype.sync);
            assert.ok(api.sync(AuthorityParent, { filename: fixture.filename }) === AuthorityParent.prototype.sync);
            assert.ok(callControl(AuthorityChild, 'schema') === childSchema);
            assert.ok(callControl(AuthorityParent, 'schema') === parentSchema);
            assert.ok(Reflect.get(schemaControl(AuthorityChild), 'connection') === connection);
            assert.ok(Reflect.get(schemaControl(AuthorityParent), 'connection') === connection);
          }
          assert.strictEqual(await schemaOutcome(schemaControl(AuthorityChild), 'ensureSchema'), null);
          assert.strictEqual(await schemaOutcome(schemaControl(AuthorityParent), 'ensureSchema'), null);
          const parent = new AuthorityParent({ name: 'after repeat', primary: child, children: [child] });
          await save(parent);
          const included = row(await cursorResult(AuthorityParent, { id: parent.id, $one: true, $include: ['primary', 'children'] }));
          assert.strictEqual(row(included.primary).id, child.id);
          assert.deepStrictEqual(
            rows(included.children).map((value) => value.id),
            [child.id]
          );
          assert.strictEqual(await cursorResult(AuthorityParent, { 'children.title': 'before inverse', $count: true }), 1);
          const found = models(await callbackResult((done) => callStatic(AuthorityParent, 'find', [{ id: parent.id }, done])));
          assert.strictEqual(found.length, 1);
          assert.strictEqual(found[0].id, parent.id);
          const fetched = new AuthorityParent({ id: parent.id });
          await fetch(fetched);
          assert.strictEqual(fetched.get('name'), 'after repeat');
          const key = row(row(callStatic(AuthorityParent, 'relation', ['children'])).reverse_relation).foreign_key;
          assert.ok(typeof key === 'string');
          assert.deepStrictEqual(rows(await callMethod(schemaDatabase(schemaControl(AuthorityChild)), 'raw', ['select id, ?? from authority_children order by id', [key]])), [
            { id: child.id, [key]: parent.id },
            { id: survivor.id, [key]: null },
          ]);
        });
      });

      it(`keeps explicitly supplied raw schema through ${format} with cache=${cache}`, async () => {
        await withRepeatedSQLiteFixture(cache, async (fixture) => {
          class RawAuthority extends BackboneSQL.Backbone.Model {
            urlRoot = fixture.url('raw_authority');
            schema(): object {
              return { name: 'String', score: 'Integer' };
            }
          }
          try {
            entry.sync(RawAuthority, { filename: fixture.filename });
          } finally {
            fixture.admitted();
          }
          const connection = Reflect.get(schemaControl(RawAuthority), 'connection');
          let previousSchema = callControl(RawAuthority, 'schema');
          await callbackCompletion((done) => callMethod(schemaControl(RawAuthority), 'createOrUpdateTable', [{}, done]));
          const saved = new RawAuthority({ name: 'survives raw schema', score: 4 });
          await save(saved);
          for (const rawForm of ['function', 'object'] as const) {
            const column = rawForm === 'object' ? 'raw_object' : 'raw_function';
            let rawCalls = 0;
            const rawDefinition = { name: 'String', score: 'Integer', raw_function: 'String', ...(rawForm === 'object' ? { raw_object: 'String' } : {}) };
            const rawSchema = (): object => {
              rawCalls += 1;
              return rawDefinition;
            };
            Reflect.set(RawAuthority.prototype, 'schema', rawForm === 'object' ? rawDefinition : rawSchema);
            try {
              assert.ok(other.sync(RawAuthority, { filename: fixture.filename }) === RawAuthority.prototype.sync);
            } finally {
              fixture.admitted();
            }
            const nextSchema = callControl(RawAuthority, 'schema');
            assert.ok(nextSchema !== previousSchema);
            if (rawForm === 'function') assert.ok(rawCalls > 0);
            else assert.strictEqual(rawCalls, 0);
            assert.ok(Reflect.get(schemaControl(RawAuthority), 'connection') === connection);
            await callbackCompletion((done) => callMethod(schemaControl(RawAuthority), 'createOrUpdateTable', [{}, done]));
            saved.set(column, rawForm);
            await save(saved);
            assert.deepStrictEqual(rows(await callMethod(schemaDatabase(schemaControl(RawAuthority)), 'raw', ['select name, score, ?? from raw_authority where id = ?', [column, numericID(saved)]])), [{ name: 'survives raw schema', score: 4, [column]: rawForm }]);
            previousSchema = nextSchema;
          }
        });
      });
    }
  }
});

function createSchemaGraph(filename: string) {
  let pivotURL = 'sqlite3:///schema_pivots';
  class SchemaPivot extends BackboneSQL.Backbone.Model {
    urlRoot = pivotURL;
    schema(): Record<string, unknown> {
      return { peer_id: ['Integer', { nullable: true }], root_id: ['Integer', { nullable: true }] };
    }
  }
  class SchemaRoot extends BackboneSQL.Backbone.Model {
    urlRoot = 'sqlite3:///schema_roots';
    schema(): Record<string, unknown> {
      return {
        left: () => ['hasMany', SchemaPeer, { as: 'left_roots', foreign_key: 'root_id', join_key: 'root_id', join_table: SchemaPivot }],
        name: ['String', { nullable: true }],
        right: () => ['hasMany', SchemaPeer, { as: 'right_roots', foreign_key: 'root_id', join_key: 'root_id', join_table: SchemaPivot }],
      };
    }
  }
  class SchemaPeer extends BackboneSQL.Backbone.Model {
    urlRoot = 'sqlite3:///schema_peers';
    schema(): Record<string, unknown> {
      return {
        left_roots: () => ['hasMany', SchemaRoot, { as: 'left', foreign_key: 'peer_id', join_key: 'peer_id', join_table: SchemaPivot }],
        right_roots: () => ['hasMany', SchemaRoot, { as: 'right', foreign_key: 'peer_id', join_key: 'peer_id', join_table: SchemaPivot }],
        title: ['String', { nullable: true }],
      };
    }
  }
  const pivotDefinition = SchemaPivot.prototype.schema;
  const configurePivot = (pivotFilename: string): void => {
    SchemaPivot.prototype.schema = pivotDefinition;
    SchemaPivot.prototype.sync = CJSBackboneSQL.sync(SchemaPivot, { filename: pivotFilename });
  };
  configurePivot(filename);
  SchemaRoot.prototype.sync = BackboneSQL.sync(SchemaRoot, { filename });
  return {
    SchemaPeer,
    SchemaPivot,
    SchemaRoot,
    configurePivot,
    setPivotURL: (url: string): void => {
      pivotURL = url;
    },
  };
}

function createDestroyGraph(filename: string) {
  class DestroyParent extends BackboneSQL.Backbone.Model {
    urlRoot = 'sqlite3:///destroy_parents';
    schema(): Record<string, unknown> {
      return {
        children: () => ['hasMany', DestroyChild, { as: 'parent' }],
        name: ['String', { nullable: false, unique: true }],
      };
    }
  }
  class DestroyChild extends BackboneSQL.Backbone.Model {
    urlRoot = 'sqlite3:///destroy_children';
    schema(): Record<string, unknown> {
      return {
        parent: () => ['belongsTo', DestroyParent, { as: 'children' }],
        title: ['String', { nullable: false }],
      };
    }
  }
  DestroyParent.prototype.sync = BackboneSQL.sync(DestroyParent, { filename });
  return { DestroyChild, DestroyParent };
}

async function destroyOutcome(modelType: object, query: Record<string, unknown>): Promise<Error | null> {
  let calls = 0;
  const error = await new Promise<Error | null>((resolve) => {
    const returned = callStatic(modelType, 'destroy', [
      query,
      function destroyCallback(...arguments_: [error?: Error | null, ...additional: unknown[]]) {
        const [error] = arguments_;
        calls += 1;
        if (error) assert.strictEqual(arguments_.length, 1);
        resolve(error ?? null);
      },
    ]);
    assert.strictEqual(returned, undefined);
    assert.strictEqual(calls, 0);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.strictEqual(calls, 1);
  return error;
}

function createDestroyIdentityGraph(filename: string) {
  class IdentityParent extends BackboneSQL.Backbone.Model {
    urlRoot = 'sqlite3:///id_selection_parents';
    schema(): Record<string, unknown> {
      return {
        children: () => ['hasMany', IdentityChild, { as: 'parent' }],
        group_id: ['Integer', { nullable: false }],
        score: ['Integer', { nullable: false }],
      };
    }
  }
  class IdentityChild extends BackboneSQL.Backbone.Model {
    urlRoot = 'sqlite3:///id_selection_children';
    schema(): Record<string, unknown> {
      return {
        parent: () => ['belongsTo', IdentityParent, { as: 'children' }],
        title: ['String', { nullable: false }],
      };
    }
  }
  IdentityParent.prototype.sync = BackboneSQL.sync(IdentityParent, { filename });
  return { IdentityChild, IdentityParent };
}

async function seedDestroyIdentityGraph(database: object): Promise<void> {
  await callMethod(database, 'raw', ['insert into id_selection_parents (id, group_id, score) values (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)', [1, 1, 30, 2, 1, 40, 3, 1, 40, 4, 2, 10, 5, 2, 100]]);
  await callMethod(database, 'raw', ['insert into id_selection_children (parent_id, title) values (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?)', [1, 'match', 2, 'match', 2, 'match', 3, 'match', 4, 'match', 5, 'unrelated']]);
}

function createImplicitColumnGraph(filename: string) {
  class LiveColumnChild extends BackboneSQL.Backbone.Model {
    urlRoot = 'sqlite3:///live_column_children';
    schema(): Record<string, unknown> {
      return { name: 'String' };
    }
  }
  class LiveColumnParent extends BackboneSQL.Backbone.Model {
    urlRoot = 'sqlite3:///live_column_parents';
    schema(): Record<string, unknown> {
      return { name: 'String', primary: () => ['belongsTo', LiveColumnChild], children: () => ['hasMany', LiveColumnChild] };
    }
  }
  return {
    LiveColumnChild,
    LiveColumnParent,
    configureChild: (): void => {
      LiveColumnChild.prototype.sync = BackboneSQL.sync(LiveColumnChild, { filename });
    },
    configureParent: (): void => {
      LiveColumnParent.prototype.sync = BackboneSQL.sync(LiveColumnParent, { filename });
    },
  };
}

function implicitForeignKey(parent: object): string {
  const relation = callStatic(parent, 'relation', ['children']);
  assert.ok(typeof relation === 'object' && relation !== null);
  const reverse: unknown = Reflect.get(relation, 'reverse_relation');
  assert.ok(typeof reverse === 'object' && reverse !== null);
  const key: unknown = Reflect.get(reverse, 'foreign_key');
  assert.strictEqual(typeof key, 'string');
  if (typeof key !== 'string') throw new Error('Expected the generated inverse foreign key');
  return key;
}

async function singleNotification(invoke: (callback: Callback) => unknown): Promise<{ error: Error | null; value: unknown }> {
  let calls = 0;
  const result = await new Promise<{ error: Error | null; value: unknown }>((resolve) => {
    invoke((error, value) => {
      calls += 1;
      resolve({ error: error ?? null, value });
    });
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.strictEqual(calls, 1);
  return result;
}

describe('public package SQLite relations', () => {
  for (const enabled of [false, true]) {
    for (const order of ['child-first', 'parent-first']) {
      it(`persists implicit inverse columns ${order} with cache ${enabled}`, async () => {
        const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
        mkdirSync(root, { recursive: true });
        BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
        const { LiveColumnChild: Child, LiveColumnParent: Parent, configureChild, configureParent } = createImplicitColumnGraph(path.join(root, 'database.sqlite3'));
        try {
          if (order === 'child-first') configureChild();
          // Parent-first uses the adapter's public createSync routing for its not-yet-configured child.
          configureParent();
          const childControl = schemaControl(Child);
          const parentControl = schemaControl(Parent);
          assert.strictEqual(Reflect.get(childControl, 'connection'), Reflect.get(parentControl, 'connection'));
          assert.strictEqual(BackboneSQL.modules['backbone-orm'], BackboneORM);
          const reset = await singleNotification((callback) => callMethod(BackboneORM.Utils, 'resetSchemas', [[Child, Parent], {}, callback]));
          assert.strictEqual(reset.error, null);
          const foreignKey = implicitForeignKey(Parent);
          assert.strictEqual(await callbackResult((callback) => callMethod(childControl, 'hasColumn', [foreignKey, callback])), true);
          const database = schemaDatabase(childControl);
          const first = new Child({ name: 'first' });
          const second = new Child({ name: 'second' });
          const unrelated = new Child({ name: 'unrelated' });
          await save(first);
          await save(second);
          await save(unrelated);
          const parent = new Parent({ name: 'parent', primary: null, children: [] });
          assert.strictEqual((await singleNotification((callback) => callMethod(parent, 'save', [callback]))).error, null);
          parent.set({ primary: first, children: [first] });
          await save(parent);
          assert.deepStrictEqual(rows(await callMethod(database, 'raw', ['select ??, ?? from ?? order by ??', ['id', foreignKey, 'live_column_children', 'id']])), [
            { id: first.id, [foreignKey]: parent.id },
            { id: second.id, [foreignKey]: null },
            { id: unrelated.id, [foreignKey]: null },
          ]);
          const included = row(await cursorResult(Parent, { id: parent.id, $one: true, $include: ['primary', 'children'] }));
          assert.strictEqual(row(included.primary).id, first.id);
          assert.deepStrictEqual(
            rows(included.children).map((child) => child.id),
            [first.id]
          );
          const found = models(await callbackResult((callback) => callStatic(Parent, 'find', [{ id: parent.id, $include: ['primary', 'children'] }, callback])));
          assert.strictEqual(found.length, 1);
          assert.strictEqual(found[0].id, parent.id);
          const fetched = new Parent({ id: parent.id });
          await fetch(fetched);
          assert.strictEqual(fetched.get('name'), 'parent');
          assert.deepStrictEqual(models(await related(fetched, 'children')).map(numericID), [numericID(first)]);
          parent.set({ primary: second, children: [second] });
          await save(parent);
          assert.deepStrictEqual(rows(await callMethod(database, 'raw', ['select ??, ?? from ?? order by ??', ['id', foreignKey, 'live_column_children', 'id']])), [
            { id: first.id, [foreignKey]: null },
            { id: second.id, [foreignKey]: parent.id },
            { id: unrelated.id, [foreignKey]: null },
          ]);
          parent.set({ primary: null, children: [] });
          await save(parent);
          const nulled = row(await cursorResult(Parent, { id: parent.id, $one: true, $include: ['primary', 'children'] }));
          assert.strictEqual(nulled.primary, null);
          assert.deepStrictEqual(nulled.children, []);
          assert.deepStrictEqual(rows(await callMethod(database, 'raw', ['select name, ?? from ?? order by id', [foreignKey, 'live_column_children']])), [
            { name: 'first', [foreignKey]: null },
            { name: 'second', [foreignKey]: null },
            { name: 'unrelated', [foreignKey]: null },
          ]);
          await callbackCompletion((callback) => callMethod(childControl, 'dropTable', [callback]));
          const failed = await singleNotification((callback) => {
            const cursor = callStatic(Parent, 'cursor', [{ id: parent.id, $include: ['children'] }]);
            assert.ok(typeof cursor === 'object' && cursor !== null);
            return callMethod(cursor, 'toJSON', [callback]);
          });
          assert.ok(failed.error instanceof Error);
          assert.match(failed.error.message, /no such table/);
          assert.strictEqual(failed.value, undefined);
        } finally {
          try {
            const close = await singleNotification((callback) => callControl(Parent, 'closeConnection', callback));
            assert.strictEqual(close.error, null);
          } finally {
            BackboneSQL.configure({ model_cache: { enabled: false } });
            safeRmSync(root);
          }
        }
      });
    }
    for (const method of ['createOrUpdateTable', 'ensureSchema']) {
      it(`adds implicit inverse columns to existing rows via ${method} with cache ${enabled}`, async () => {
        const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
        mkdirSync(root, { recursive: true });
        BackboneSQL.configure({ model_cache: { enabled, max: 100 } });
        const { LiveColumnChild: Child, LiveColumnParent: Parent, configureChild, configureParent } = createImplicitColumnGraph(path.join(root, 'database.sqlite3'));
        configureChild();
        try {
          const childControl = schemaControl(Child);
          assert.strictEqual(await schemaOutcome(childControl, 'ensureSchema'), null);
          const existing = new Child({ name: 'existing' });
          const survivor = new Child({ name: 'survivor' });
          await save(existing);
          await save(survivor);
          configureParent();
          const foreignKey = implicitForeignKey(Parent);
          assert.strictEqual(await callbackResult((callback) => callMethod(childControl, 'hasColumn', [foreignKey, callback])), false);
          const added = await singleNotification((callback) => callMethod(childControl, method, [{}, callback]));
          assert.strictEqual(added.error, null);
          assert.strictEqual(await callbackResult((callback) => callMethod(childControl, 'hasColumn', [foreignKey, callback])), true);
          assert.strictEqual(await schemaOutcome(schemaControl(Parent), 'ensureSchema'), null);
          const parent = new Parent({ name: 'parent', primary: existing, children: [existing] });
          await save(parent);
          const database = schemaDatabase(childControl);
          assert.deepStrictEqual(rows(await callMethod(database, 'raw', ['select id, name, ?? from ?? order by id', [foreignKey, 'live_column_children']])), [
            { id: existing.id, name: 'existing', [foreignKey]: parent.id },
            { id: survivor.id, name: 'survivor', [foreignKey]: null },
          ]);
          const included = row(await cursorResult(Parent, { id: parent.id, $one: true, $include: ['primary', 'children'] }));
          assert.strictEqual(row(included.primary).id, existing.id);
          assert.deepStrictEqual(
            rows(included.children).map((child) => child.id),
            [existing.id]
          );
        } finally {
          try {
            assert.strictEqual((await singleNotification((callback) => callControl(Child, 'closeConnection', callback))).error, null);
          } finally {
            BackboneSQL.configure({ model_cache: { enabled: false } });
            safeRmSync(root);
          }
        }
      });
    }
  }

  it('preserves duplicate ordinary projections when privately selecting destroy IDs', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    mkdirSync(root, { recursive: true });
    BackboneSQL.configure({ model_cache: { enabled: false } });
    const { IdentityChild, IdentityParent } = createDestroyIdentityGraph(path.join(root, 'database.sqlite3'));
    const database = schemaDatabase(schemaControl(IdentityParent));
    try {
      assert.strictEqual(await schemaOutcome(schemaControl(IdentityParent), 'ensureSchema'), null);
      assert.strictEqual(await schemaOutcome(schemaControl(IdentityChild), 'ensureSchema'), null);
      await seedDestroyIdentityGraph(database);
      const query = Object.freeze({ $limit: 2, $offset: 1, $select: Object.freeze(['group_id']), $sort: Object.freeze(['-score', 'id']), $whitelist: Object.freeze(['group_id']), 'children.title': 'match' });
      const candidates = rows(await cursorResult(IdentityParent, { ...query, $select: ['group_id', 'id'], $whitelist: ['group_id', 'id'] }));
      const oracle = rows(await callMethod(database, 'raw', ['select p.group_id, p.id from id_selection_parents p where exists (select 1 from id_selection_children c where c.parent_id = p.id and c.title = ?) order by p.score desc, p.id asc limit ? offset ?', ['match', 2, 1]]));
      assert.deepStrictEqual(candidates, oracle);
      assert.deepStrictEqual(
        candidates.map((value) => value.id),
        [3, 1]
      );
      assert.deepStrictEqual(await cursorResult(IdentityParent, query), [{ group_id: 1 }, { group_id: 1 }]);
      assert.deepStrictEqual(query.$select, ['group_id']);
      assert.deepStrictEqual(query.$whitelist, ['group_id']);
      assert.deepStrictEqual(
        rows(await cursorResult(IdentityParent, { $select: ['group_id', 'id'], $sort: 'id' })).map((value) => value.id),
        [1, 2, 3, 4, 5]
      );
      assert.deepStrictEqual(await cursorResult(IdentityParent, { ...query, 'children.title': 'absent' }), []);
    } finally {
      try {
        await closeModels(IdentityParent, IdentityChild);
      } finally {
        BackboneSQL.configure({ model_cache: { enabled: false } });
        safeRmSync(root);
      }
    }
  });

  it('uses hidden IDs for cache-off static destroy without changing selected rows or serial order', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    mkdirSync(root, { recursive: true });
    BackboneSQL.configure({ model_cache: { enabled: false } });
    const { IdentityChild, IdentityParent } = createDestroyIdentityGraph(path.join(root, 'database.sqlite3'));
    const database = schemaDatabase(schemaControl(IdentityParent));
    const deletedIDs: unknown[] = [];
    callMethod(database, 'on', [
      'query',
      (query: { bindings: unknown[]; sql: string }) => {
        if (/^delete from/i.test(query.sql) && query.sql.includes('id_selection_parents')) deletedIDs.push(query.bindings[0]);
      },
    ]);
    try {
      assert.strictEqual(await schemaOutcome(schemaControl(IdentityParent), 'ensureSchema'), null);
      assert.strictEqual(await schemaOutcome(schemaControl(IdentityChild), 'ensureSchema'), null);
      await seedDestroyIdentityGraph(database);
      const query = Object.freeze({ $limit: 2, $offset: 1, $select: Object.freeze(['group_id']), $sort: Object.freeze(['-score', 'id']), $whitelist: Object.freeze(['group_id']), 'children.title': 'match' });
      assert.deepStrictEqual(await cursorResult(IdentityParent, query), [{ group_id: 1 }, { group_id: 1 }]);
      assert.strictEqual(await destroyOutcome(IdentityParent, query), null);
      assert.deepStrictEqual(deletedIDs, [3, 1]);
      assert.deepStrictEqual(
        rows(await cursorResult(IdentityParent, { $sort: 'id' })).map((value) => value.id),
        [2, 4, 5]
      );
      assert.deepStrictEqual(
        rows(await cursorResult(IdentityChild, { $sort: 'id' })).map((value) => value.parent_id),
        [null, 2, 2, null, 4, 5]
      );
      assert.deepStrictEqual(await cursorResult(IdentityParent, { $select: ['group_id'], $sort: 'id' }), [{ group_id: 1 }, { group_id: 2 }, { group_id: 2 }]);
      assert.deepStrictEqual(query.$select, ['group_id']);
      assert.deepStrictEqual(query.$whitelist, ['group_id']);
      assert.strictEqual(await destroyOutcome(IdentityParent, { ...query, 'children.title': 'absent' }), null);
      assert.deepStrictEqual(deletedIDs, [3, 1]);
    } finally {
      try {
        await closeModels(IdentityParent, IdentityChild);
      } finally {
        BackboneSQL.configure({ model_cache: { enabled: false } });
        safeRmSync(root);
      }
    }
  });

  it('uses retained default ID order and explicit serial iteration for ordinary cache-off static destroy', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    mkdirSync(root, { recursive: true });
    BackboneSQL.configure({ model_cache: { enabled: false } });
    const { IdentityChild, IdentityParent } = createDestroyIdentityGraph(path.join(root, 'database.sqlite3'));
    const database = schemaDatabase(schemaControl(IdentityParent));
    const deletedIDs: unknown[] = [];
    callMethod(database, 'on', [
      'query',
      (query: { bindings: unknown[]; sql: string }) => {
        if (/^delete from/i.test(query.sql) && query.sql.includes('id_selection_parents')) deletedIDs.push(query.bindings[0]);
      },
    ]);
    try {
      assert.strictEqual(await schemaOutcome(schemaControl(IdentityParent), 'ensureSchema'), null);
      assert.strictEqual(await schemaOutcome(schemaControl(IdentityChild), 'ensureSchema'), null);
      await seedDestroyIdentityGraph(database);
      const query = Object.freeze({ $each: Object.freeze({ threads: 1 }), $select: Object.freeze(['score']), group_id: 1 });
      assert.strictEqual(await destroyOutcome(IdentityParent, query), null);
      assert.deepStrictEqual(deletedIDs, [1, 2, 3]);
      assert.deepStrictEqual(query.$each, { threads: 1 });
      assert.deepStrictEqual(query.$select, ['score']);
      assert.deepStrictEqual(
        rows(await cursorResult(IdentityParent, { $sort: 'id' })).map((value) => value.id),
        [4, 5]
      );
      assert.deepStrictEqual(
        rows(await cursorResult(IdentityChild, { $sort: 'id' })).map((value) => value.parent_id),
        [null, null, null, null, 4, 5]
      );
      assert.deepStrictEqual(await cursorResult(IdentityParent, { $select: ['score'], $sort: 'id' }), [{ score: 10 }, { score: 100 }]);
    } finally {
      try {
        await closeModels(IdentityParent, IdentityChild);
      } finally {
        BackboneSQL.configure({ model_cache: { enabled: false } });
        safeRmSync(root);
      }
    }
  });

  it('rejects unimplemented static destroy shapes and iteration controls before mutation', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    mkdirSync(root, { recursive: true });
    BackboneSQL.configure({ model_cache: { enabled: false } });
    const { IdentityChild, IdentityParent } = createDestroyIdentityGraph(path.join(root, 'database.sqlite3'));
    const database = schemaDatabase(schemaControl(IdentityParent));
    const deletedIDs: unknown[] = [];
    callMethod(database, 'on', [
      'query',
      (query: { bindings: unknown[]; sql: string }) => {
        if (/^delete from/i.test(query.sql) && query.sql.includes('id_selection_parents')) deletedIDs.push(query.bindings[0]);
      },
    ]);
    try {
      assert.strictEqual(await schemaOutcome(schemaControl(IdentityParent), 'ensureSchema'), null);
      assert.strictEqual(await schemaOutcome(schemaControl(IdentityChild), 'ensureSchema'), null);
      await seedDestroyIdentityGraph(database);
      const unsupported: Record<string, unknown>[] = [
        { $unique: ['group_id'] },
        { $values: ['group_id'] },
        { $count: true },
        { $exists: true },
        { $page: true },
        { $one: true },
        { $each: { fetch: 1000 } },
        { $each: { threads: 2 } },
        { $each: { threads: 1, fetch: 1000 } },
        { $each: { threads: 1, json: true } },
        { $each: {} },
        { $each: null },
      ];
      for (const controls of unsupported) {
        const query = Object.freeze({ ...controls, $select: Object.freeze(['group_id']), 'children.title': 'match' });
        const error = await destroyOutcome(IdentityParent, query);
        assert.ok(error instanceof Error);
        assert.match(error.message, /SQLite destroy.*not implemented/);
        assert.deepStrictEqual(query.$select, ['group_id']);
        assert.deepStrictEqual(deletedIDs, []);
      }
      const invalidRelation = await destroyOutcome(IdentityParent, { 'missing.title': 'match' });
      assert.ok(invalidRelation instanceof Error);
      assert.deepStrictEqual(deletedIDs, []);
      assert.deepStrictEqual(
        rows(await cursorResult(IdentityParent, { $sort: 'id' })).map((value) => value.id),
        [1, 2, 3, 4, 5]
      );
      assert.deepStrictEqual(
        rows(await cursorResult(IdentityChild, { $sort: 'id' })).map((value) => value.parent_id),
        [1, 2, 2, 3, 4, 5]
      );
    } finally {
      try {
        await closeModels(IdentityParent, IdentityChild);
      } finally {
        BackboneSQL.configure({ model_cache: { enabled: false } });
        safeRmSync(root);
      }
    }
  });

  it('validates every static destroy candidate identity before any DELETE on real SQLite', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    mkdirSync(root, { recursive: true });
    BackboneSQL.configure({ model_cache: { enabled: false } });
    const { IdentityChild, IdentityParent } = createDestroyIdentityGraph(path.join(root, 'database.sqlite3'));
    const database = schemaDatabase(schemaControl(IdentityParent));
    const deletedIDs: unknown[] = [];
    callMethod(database, 'on', [
      'query',
      (query: { bindings: unknown[]; sql: string }) => {
        if (/^delete from/i.test(query.sql) && query.sql.includes('id_selection_parents')) deletedIDs.push(query.bindings[0]);
      },
    ]);
    try {
      // A real pre-existing SQLite table can lack the configured primary-key constraint.
      await callMethod(database, 'raw', ['create table id_selection_parents (id integer, group_id integer, score integer)']);
      await callMethod(database, 'raw', ['insert into id_selection_parents (id, group_id, score) values (?, ?, ?), (?, ?, ?), (?, ?, ?)', [1, 1, 10, 2, 1, 20, null, 1, 30]]);
      const query = Object.freeze({ $select: Object.freeze(['group_id']), $sort: '-id', group_id: 1 });
      assert.deepStrictEqual(
        rows(await cursorResult(IdentityParent, { ...query, $select: ['id'] })).map((value) => value.id),
        [2, 1, null]
      );
      const error = await destroyOutcome(IdentityParent, query);
      assert.ok(error instanceof Error);
      assert.match(error.message, /invalid id; no rows were deleted/);
      assert.deepStrictEqual(deletedIDs, []);
      assert.deepStrictEqual(query.$select, ['group_id']);
      const remaining = rows(await callMethod(database, 'raw', ['select id from id_selection_parents order by id desc']));
      assert.deepStrictEqual(
        remaining.map((value) => value.id),
        [2, 1, null]
      );
    } finally {
      try {
        await closeModels(IdentityParent, IdentityChild);
      } finally {
        BackboneSQL.configure({ model_cache: { enabled: false } });
        safeRmSync(root);
      }
    }
  });

  for (const cacheEnabled of [false, true]) {
    it(`selects static destroy through relation predicates and ordered limits with cache ${cacheEnabled ? 'on' : 'off'}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
      mkdirSync(root, { recursive: true });
      BackboneSQL.configure({ model_cache: { enabled: cacheEnabled, max: 100 } });
      const { DestroyChild, DestroyParent } = createDestroyGraph(path.join(root, 'database.sqlite3'));
      const database = schemaDatabase(schemaControl(DestroyParent));
      try {
        assert.strictEqual(await schemaOutcome(schemaControl(DestroyParent), 'ensureSchema'), null);
        assert.strictEqual(await schemaOutcome(schemaControl(DestroyChild), 'ensureSchema'), null);
        const first = new DestroyParent({ name: 'first' });
        const second = new DestroyParent({ name: 'second' });
        const survivor = new DestroyParent({ name: 'unrelated' });
        await save(first);
        await save(second);
        await save(survivor);
        await callMethod(database, 'raw', ['insert into destroy_children (parent_id, title) values (?, ?), (?, ?), (?, ?), (?, ?)', [first.id, 'match', second.id, 'match', second.id, 'match', survivor.id, 'other']]);
        assert.deepStrictEqual(
          rows(await cursorResult(DestroyParent, { $sort: '-name', 'children.title': 'match' })).map((value) => value.id),
          [second.id, first.id]
        );
        assert.strictEqual(await destroyOutcome(DestroyParent, { $limit: 1, $select: ['id', 'name'], $sort: '-name', 'children.title': 'match' }), null);
        assert.deepStrictEqual(
          rows(await cursorResult(DestroyParent, { $sort: 'id' })).map((value) => value.id),
          [first.id, survivor.id]
        );
        assert.deepStrictEqual(
          rows(await cursorResult(DestroyChild, { $sort: 'id' })).map((value) => value.parent_id),
          [first.id, null, null, survivor.id]
        );
        assert.strictEqual(await callbackResult((callback) => callStatic(DestroyParent, 'findOne', [{ id: second.id }, callback])), null);
        const foundSurvivor = await callbackResult((callback) => callStatic(DestroyParent, 'findOne', [{ id: survivor.id }, callback]));
        if (cacheEnabled) assert.strictEqual(foundSurvivor, survivor);
        assert.strictEqual(await destroyOutcome(DestroyParent, { 'children.title': { $in: [] } }), null);
        assert.strictEqual(rows(await cursorResult(DestroyParent, {})).length, 2);
        const invalidRelation = await destroyOutcome(DestroyParent, { 'missing.title': 'match' });
        assert.ok(invalidRelation instanceof Error);
        assert.match(invalidRelation.message, /Included relation 'missing' is not a relation/);
        assert.strictEqual(rows(await cursorResult(DestroyParent, {})).length, 2);
      } finally {
        try {
          await closeModels(DestroyParent, DestroyChild);
        } finally {
          BackboneSQL.configure({ model_cache: { enabled: false } });
          safeRmSync(root);
        }
      }
    });

    it(`deletes every selected row across the 1000 boundary with cache ${cacheEnabled ? 'on' : 'off'}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
      mkdirSync(root, { recursive: true });
      BackboneSQL.configure({ model_cache: { enabled: cacheEnabled, max: 100 } });
      const { DestroyChild, DestroyParent } = createDestroyGraph(path.join(root, 'database.sqlite3'));
      const database = schemaDatabase(schemaControl(DestroyParent));
      try {
        for (const size of [999, 1000, 1001]) {
          assert.strictEqual(await schemaOutcome(schemaControl(DestroyParent), 'resetSchema'), null);
          assert.strictEqual(await schemaOutcome(schemaControl(DestroyChild), 'resetSchema'), null);
          await callMethod(database, 'raw', ['with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < ?) insert into destroy_parents (name) select ? || n from numbers', [size, 'selected-']]);
          await callMethod(database, 'raw', ['insert into destroy_children (parent_id, title) select id, ? from destroy_parents', ['match']]);
          const survivor = new DestroyParent({ name: 'survivor' });
          await save(survivor);
          await callMethod(database, 'raw', ['insert into destroy_children (parent_id, title) values (?, ?)', [survivor.id, 'independent']]);
          assert.strictEqual(await destroyOutcome(DestroyParent, { 'children.title': 'match' }), null);
          assert.deepStrictEqual(
            rows(await cursorResult(DestroyParent, {})).map((value) => value.id),
            [survivor.id]
          );
          const children = rows(await cursorResult(DestroyChild, {}));
          assert.strictEqual(children.length, size + 1);
          assert.strictEqual(children.filter((value) => value.parent_id === null).length, size);
          assert.strictEqual(children.find((value) => value.title === 'independent')?.parent_id, survivor.id);
        }
      } finally {
        try {
          await closeModels(DestroyParent, DestroyChild);
        } finally {
          BackboneSQL.configure({ model_cache: { enabled: false } });
          safeRmSync(root);
        }
      }
    });

    for (const failure of ['delete', 'cleanup']) {
      it(`reports original static destroy ${failure} failure once with visible partial effects and cache ${cacheEnabled ? 'on' : 'off'}`, async () => {
        const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
        mkdirSync(root, { recursive: true });
        BackboneSQL.configure({ model_cache: { enabled: cacheEnabled, max: 100 } });
        const { DestroyChild, DestroyParent } = createDestroyGraph(path.join(root, 'database.sqlite3'));
        const database = schemaDatabase(schemaControl(DestroyParent));
        let driverError: unknown;
        callMethod(database, 'on', [
          'query-error',
          (error: unknown) => {
            driverError = error;
          },
        ]);
        try {
          assert.strictEqual(await schemaOutcome(schemaControl(DestroyParent), 'ensureSchema'), null);
          assert.strictEqual(await schemaOutcome(schemaControl(DestroyChild), 'ensureSchema'), null);
          for (const name of ['first', 'second', 'third', 'unrelated']) await save(new DestroyParent({ name }));
          await callMethod(database, 'raw', ['insert into destroy_children (parent_id, title) select id, name from destroy_parents']);
          const trigger =
            failure === 'delete'
              ? "create trigger reject_second before delete on destroy_parents when old.name = 'second' begin select raise(abort, 'owned delete failure'); end"
              : "create trigger reject_cleanup before update of parent_id on destroy_children when old.title = 'second' begin select raise(abort, 'owned cleanup failure'); end";
          await callMethod(database, 'raw', [trigger]);
          const error = await destroyOutcome(DestroyParent, { $each: { threads: 1 }, $sort: 'id', name: { $in: ['first', 'second', 'third'] } });
          const remaining = rows(await cursorResult(DestroyParent, { $sort: 'id' }));
          const childrenAfterFailure = rows(await cursorResult(DestroyChild, { $sort: 'id' }));
          process.stdout.write(
            `${JSON.stringify({ cacheEnabled, failure, callbackError: error?.message, driverError: driverError instanceof Error ? driverError.message : null, originalCause: error === driverError, remaining: remaining.map((value) => value.name), childParentIDs: childrenAfterFailure.map((value) => value.parent_id) })}\n`
          );
          assert.ok(error instanceof Error);
          assert.strictEqual(error, driverError);
          assert.match(error.message, failure === 'delete' ? /owned delete failure/ : /owned cleanup failure/);
          assert.deepStrictEqual(
            remaining.map((value) => value.name),
            failure === 'delete' ? ['second', 'third', 'unrelated'] : ['third', 'unrelated']
          );
          assert.deepStrictEqual(
            childrenAfterFailure.map((value) => value.parent_id),
            [null, 2, 3, 4]
          );
          assert.strictEqual(await callbackResult((callback) => callStatic(DestroyParent, 'findOne', [{ id: 1 }, callback])), null);
          const survivor = await callbackResult((callback) => callStatic(DestroyParent, 'findOne', [{ id: 4 }, callback]));
          assert.ok(survivor instanceof DestroyParent);
          assert.strictEqual(survivor.get('name'), 'unrelated');
          await callMethod(database, 'raw', [`drop trigger ${failure === 'delete' ? 'reject_second' : 'reject_cleanup'}`]);
          assert.strictEqual(await destroyOutcome(DestroyParent, { id: 3 }), null);
          assert.deepStrictEqual(
            rows(await cursorResult(DestroyParent, { $sort: 'id' })).map((value) => value.name),
            failure === 'delete' ? ['second', 'unrelated'] : ['unrelated']
          );
        } finally {
          try {
            await closeModels(DestroyParent, DestroyChild);
          } finally {
            BackboneSQL.configure({ model_cache: { enabled: false } });
            safeRmSync(root);
          }
        }
      });
    }
  }

  for (const cacheEnabled of [false, true]) {
    it(`serializes owned schema jobs and duplicate mixed-entry pivots with cache ${cacheEnabled ? 'on' : 'off'}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');
      mkdirSync(root, { recursive: true });
      BackboneSQL.configure({ model_cache: { enabled: cacheEnabled, max: 100 } });
      const { SchemaPeer, SchemaPivot, SchemaRoot } = createSchemaGraph(filename);
      const control = schemaControl(SchemaRoot);
      const pivotControl = schemaControl(SchemaPivot);
      const database = schemaDatabase(control);
      const ddl: string[] = [];
      let connectionsClosed = false;
      callMethod(database, 'on', [
        'query',
        (query: { sql: string }) => {
          if (!/^(?:drop table|create table)/i.test(query.sql)) return;
          const operation = /^drop/i.test(query.sql) ? 'drop' : 'create';
          if (query.sql.includes('schema_roots')) ddl.push(`${operation}:root`);
          if (query.sql.includes('schema_pivots')) ddl.push(`${operation}:pivot`);
        },
      ]);
      try {
        assert.strictEqual(Reflect.get(control, 'connection'), Reflect.get(pivotControl, 'connection'));
        assert.strictEqual(joinTable(SchemaRoot, 'left'), SchemaPivot);
        assert.strictEqual(joinTable(SchemaRoot, 'right'), SchemaPivot);
        const ormSchema = callStatic(SchemaRoot, 'schema', []);
        if (typeof ormSchema !== 'object' || ormSchema === null) throw new Error('Expected configured ORM schema');
        assert.deepStrictEqual(callMethod(ormSchema, 'joinTables', []), [SchemaPivot, SchemaPivot]);
        await callMethod(database, 'raw', ['create table schema_roots (id integer primary key autoincrement, extra text)']);
        await callMethod(database, 'raw', ['insert into schema_roots (extra) values (?)', ['preserved']]);
        assert.strictEqual(await schemaOutcome(control, 'ensureSchema', { verbose: false }), null);
        assert.deepStrictEqual(rows(await callMethod(database, 'raw', ['select id, name, extra from schema_roots'])), [{ extra: 'preserved', id: 1, name: null }]);
        assert.strictEqual(await schemaOutcome(control, 'ensureSchema'), null);
        assert.strictEqual(await schemaOutcome(schemaControl(SchemaPeer), 'ensureSchema'), null);
        await callMethod(database, 'raw', ['insert into schema_peers (title) values (?)', ['independent']]);
        await callMethod(database, 'raw', ['insert into schema_pivots (root_id, peer_id) values (?, ?)', [1, 1]]);
        assert.strictEqual(await schemaOutcome(control, 'ensureSchema'), null);
        assert.deepStrictEqual(rows(await callMethod(database, 'raw', ['select root_id, peer_id from schema_pivots'])), [{ peer_id: 1, root_id: 1 }]);
        const liveModel = new SchemaRoot({ name: 'live-before-ensure' });
        await save(liveModel);
        assert.strictEqual(await schemaOutcome(control, 'ensureSchema'), null);
        const found = await callbackResult((callback) => callStatic(SchemaRoot, 'findOne', [{ id: liveModel.id }, callback]));
        assert.ok(found instanceof SchemaRoot);
        if (cacheEnabled) assert.strictEqual(found, liveModel);
        else assert.notStrictEqual(found, liveModel);
        ddl.length = 0;
        assert.strictEqual(await schemaOutcome(control, 'resetSchema', { verbose: false }), null);
        assert.deepStrictEqual(ddl, ['drop:root', 'drop:pivot', 'create:pivot', 'create:root']);
        assert.deepStrictEqual(rows(await callMethod(database, 'raw', ['select * from schema_roots'])), []);
        assert.deepStrictEqual(rows(await callMethod(database, 'raw', ['select * from schema_pivots'])), []);
        assert.deepStrictEqual(rows(await callMethod(database, 'raw', ['select title from schema_peers'])), [{ title: 'independent' }]);

        for (const modes of [
          ['ensureSchema', 'ensureSchema'],
          ['resetSchema', 'resetSchema'],
          ['ensureSchema', 'resetSchema'],
        ]) {
          const first = modes[0];
          const second = modes[1];
          if ((first !== 'ensureSchema' && first !== 'resetSchema') || (second !== 'ensureSchema' && second !== 'resetSchema')) throw new Error('Invalid schema modes');
          ddl.length = 0;
          const resets = modes.filter((mode) => mode === 'resetSchema').length;
          const expectedDDL = Array.from({ length: resets }, () => ['drop:root', 'drop:pivot', 'create:pivot', 'create:root']).flat();
          let rootColumnResponses = 0;
          const columnResponse = (_response: unknown, query: { sql: string }): void => {
            if (/^PRAGMA table_info/i.test(query.sql) && query.sql.includes('schema_roots')) rootColumnResponses += 1;
          };
          callMethod(database, 'on', ['query-response', columnResponse]);
          try {
            const firstJob = schemaOutcome(control, first, undefined, () => {
              if (resets === 0) assert.ok(rootColumnResponses >= 2);
            });
            const secondJob = schemaOutcome(control, second, undefined, () => {
              assert.deepStrictEqual(ddl.slice(), expectedDDL);
              if (resets === 0) assert.strictEqual(rootColumnResponses, 4);
            });
            assert.deepStrictEqual(await Promise.all([firstJob, secondJob]), [null, null]);
          } finally {
            callMethod(database, 'removeListener', ['query-response', columnResponse]);
          }
          assert.deepStrictEqual(ddl, expectedDDL);
        }

        let driverError: unknown;
        callMethod(database, 'on', [
          'query-error',
          (error: unknown) => {
            driverError = error;
          },
        ]);
        await callMethod(database, 'raw', ['PRAGMA query_only = ON']);
        const failed = await schemaOutcome(control, 'resetSchema');
        assert.ok(failed instanceof Error);
        assert.match(failed.message, /readonly/);
        assert.strictEqual(failed, driverError);
        await callMethod(database, 'raw', ['PRAGMA query_only = OFF']);
        assert.strictEqual(await schemaOutcome(control, 'resetSchema'), null);

        let firstCalls = 0;
        let reentrantCalls = 0;
        await new Promise<void>((resolve, reject) => {
          const returned = callMethod(control, 'ensureSchema', [
            (error: Error | null) => {
              firstCalls += 1;
              if (error) return reject(error);
              const nested = callMethod(pivotControl, 'resetSchema', [
                (nestedError: Error | null) => {
                  reentrantCalls += 1;
                  if (nestedError) reject(nestedError);
                  else resolve();
                },
              ]);
              assert.strictEqual(nested, undefined);
            },
          ]);
          assert.strictEqual(returned, undefined);
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(firstCalls, 1);
        assert.strictEqual(reentrantCalls, 1);

        await closeModels(SchemaRoot, SchemaPeer, SchemaPivot);
        connectionsClosed = true;
        const closed = await schemaOutcome(control, 'ensureSchema');
        assert.ok(closed instanceof Error);
        assert.match(closed.message, /SQLite connection is closed/);
      } finally {
        try {
          if (!connectionsClosed) await closeModels(SchemaRoot, SchemaPeer, SchemaPivot);
        } finally {
          BackboneSQL.configure({ model_cache: { enabled: false } });
          safeRmSync(root);
        }
      }
    });
  }

  it('rejects foreign and replaced pivot ownership before DDL and rechecks callers after queue wait', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    const foreignFilename = path.join(root, 'foreign.sqlite3');
    mkdirSync(root, { recursive: true });
    BackboneSQL.configure({ model_cache: { enabled: false } });
    const { SchemaPeer, SchemaPivot, SchemaRoot, configurePivot, setPivotURL } = createSchemaGraph(filename);
    const control = schemaControl(SchemaRoot);
    const database = schemaDatabase(control);
    let ddlCount = 0;
    callMethod(database, 'on', [
      'query',
      (query: { sql: string }) => {
        if (/^(?:drop table|create table|alter table)/i.test(query.sql)) ddlCount += 1;
      },
    ]);
    try {
      assert.strictEqual(await schemaOutcome(control, 'ensureSchema'), null);
      await callMethod(database, 'raw', ['insert into schema_roots (name) values (?)', ['preserve-before-preflight']]);
      let before = ddlCount;
      const pivotSync = SchemaPivot.prototype.sync;
      SchemaPivot.prototype.sync = BackboneSQL.Backbone.sync;
      try {
        const rejected = await schemaOutcome(control, 'resetSchema');
        assert.ok(rejected instanceof Error);
        assert.match(rejected.message, /no longer configured by this adapter/);
        assert.strictEqual(ddlCount, before);
      } finally {
        SchemaPivot.prototype.sync = pivotSync;
      }

      setPivotURL('sqlite3://foreign_schema/schema_pivots');
      configurePivot(foreignFilename);
      const foreignControl = schemaControl(SchemaPivot);
      try {
        assert.notStrictEqual(Reflect.get(foreignControl, 'connection'), Reflect.get(control, 'connection'));
        const rejected = await schemaOutcome(control, 'resetSchema');
        assert.ok(rejected instanceof Error);
        assert.match(rejected.message, /cross-database relations are not implemented/);
        assert.strictEqual(ddlCount, before);
        assert.deepStrictEqual(rows(await callMethod(database, 'raw', ['select name from schema_roots'])), [{ name: 'preserve-before-preflight' }]);
      } finally {
        await callControl(SchemaPivot, 'closeConnection');
        setPivotURL('sqlite3:///schema_pivots');
        configurePivot(filename);
      }

      assert.strictEqual(await schemaOutcome(control, 'ensureSchema'), null);
      const activeRootSync = SchemaRoot.prototype.sync;
      let changed = false;
      const replaceAfterQuery = (query: { sql: string }): void => {
        if (changed || !/^drop table/i.test(query.sql)) return;
        changed = true;
        SchemaRoot.prototype.sync = BackboneSQL.Backbone.sync;
      };
      callMethod(database, 'on', ['query', replaceAfterQuery]);
      before = ddlCount;
      try {
        const first = schemaOutcome(control, 'resetSchema');
        const queued = schemaOutcome(control, 'ensureSchema');
        const failures = await Promise.all([first, queued]);
        for (const failure of failures) {
          assert.ok(failure instanceof Error);
          assert.match(failure.message, /no longer configured by this adapter/);
        }
        assert.strictEqual(changed, true);
        assert.strictEqual(ddlCount, before + 1);
      } finally {
        callMethod(database, 'removeListener', ['query', replaceAfterQuery]);
        SchemaRoot.prototype.sync = activeRootSync;
      }
      assert.strictEqual(await schemaOutcome(control, 'ensureSchema'), null);
    } finally {
      try {
        await closeModels(SchemaRoot, SchemaPeer, SchemaPivot);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('allows schema jobs on independent owned connections to make progress concurrently', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    mkdirSync(root, { recursive: true });
    class WideSchema extends BackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3://wide_schema/schema_wide';
      schema(): Record<string, unknown> {
        return Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`field_${String(index)}`, ['Text', { nullable: true }]]));
      }
    }
    class IndependentSchema extends BackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3://independent_schema/schema_independent';
      schema(): Record<string, unknown> {
        return { name: ['Text', { nullable: true }] };
      }
    }
    BackboneSQL.configure({ model_cache: { enabled: false } });
    const filename = path.join(root, 'database.sqlite3');
    WideSchema.prototype.sync = BackboneSQL.sync(WideSchema, { filename });
    IndependentSchema.prototype.sync = CJSBackboneSQL.sync(IndependentSchema, { filename });
    const wideControl = schemaControl(WideSchema);
    const independentControl = schemaControl(IndependentSchema);
    const wideDatabase = schemaDatabase(wideControl);
    const independentDatabase = schemaDatabase(independentControl);
    try {
      assert.notStrictEqual(Reflect.get(wideControl, 'connection'), Reflect.get(independentControl, 'connection'));
      await callMethod(wideDatabase, 'raw', ['create table schema_wide (id integer primary key autoincrement)']);
      assert.strictEqual(await schemaOutcome(independentControl, 'ensureSchema'), null);
      const order: string[] = [];
      callMethod(wideDatabase, 'on', [
        'query-response',
        (_response: unknown, query: { sql: string }) => {
          if (/^alter table/i.test(query.sql) && query.sql.includes('field_15')) order.push('wide-final-ddl');
        },
      ]);
      callMethod(independentDatabase, 'on', [
        'query',
        () => {
          order.push('independent-query');
        },
      ]);
      const wide = schemaOutcome(wideControl, 'ensureSchema');
      const independent = schemaOutcome(independentControl, 'resetSchema');
      assert.deepStrictEqual(await Promise.all([wide, independent]), [null, null]);
      assert.ok(order.indexOf('independent-query') >= 0);
      assert.ok(order.indexOf('wide-final-ddl') >= 0);
      assert.ok(order.indexOf('independent-query') < order.indexOf('wide-final-ddl'), order.join(', '));
      const columns = rows(await callMethod(wideDatabase, 'raw', ['PRAGMA table_info(schema_wide)']));
      assert.strictEqual(columns.length, 17);
    } finally {
      try {
        await closeModels(WideSchema, IndependentSchema);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('persists, fetches, includes, and replaces belongsTo and hasMany rows with cache disabled', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    BackboneSQL.configure({ model_cache: { enabled: false } });
    Parent.prototype.sync = BackboneSQL.sync(Parent, { filename });
    try {
      await callbackCompletion((callback) => callStatic(Parent, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(Child, 'resetSchema', [{}, callback]));

      const childDatabase = callStatic(Child, 'db', []);
      if (typeof childDatabase !== 'object' || childDatabase === null) throw new Error('Child database control was not returned');
      const childSchema = Reflect.get(childDatabase, 'schema');
      assert.strictEqual(await callMethod(childSchema, 'hasColumn', ['parent_id']), true);

      const first = new Child({ title: 'first' });
      const second = new Child({ title: 'second' });
      await save(first);
      await save(second);
      const parent = new Parent({ children: [first, second], name: 'primary' });
      await save(parent);
      assert.strictEqual(typeof parent.id, 'number');
      assert.strictEqual(typeof first.id, 'number');
      assert.strictEqual(typeof second.id, 'number');

      const direct = new Child({ parent, title: 'direct' });
      await save(direct);
      const independent = new Child({ title: 'independent' });
      await save(independent);
      const otherChild = new Child({ title: 'other-child' });
      const otherParent = new Parent({ children: [otherChild], name: 'other' });
      await save(otherParent);

      const found = await callbackResult((callback) => callStatic(Parent, 'findOne', [{ id: parent.id }, callback]));
      assert.ok(found instanceof Parent);
      assert.notStrictEqual(found, parent);

      const fetched = new Parent({ id: numericID(parent) });
      await fetch(fetched);
      const fetchedChildren = models(await related(fetched, 'children'));
      assert.deepStrictEqual(fetchedChildren.map((child) => child.get('title')).sort(), ['direct', 'first', 'second']);

      const fetchedFirst = new Child({ id: numericID(first) });
      await fetch(fetchedFirst);
      const fetchedParent = await related(fetchedFirst, 'parent');
      assert.ok(fetchedParent instanceof Parent);
      assert.strictEqual(fetchedParent.id, parent.id);

      const parentRow = row(await cursorResult(Parent, { $include: ['children'], $one: true, id: parent.id }));
      assert.deepStrictEqual(
        rows(parentRow.children)
          .map((relatedRow) => relatedRow.title)
          .sort(),
        ['direct', 'first', 'second']
      );
      const childRows = rows(await cursorResult(Child, { $include: ['parent'], $sort: 'id' }));
      const independentRow = childRows.find((row) => row.id === independent.id);
      assert.deepStrictEqual(independentRow?.parent, null);
      const firstRow = childRows.find((row) => row.id === first.id);
      assert.strictEqual(row(firstRow?.parent).id, parent.id);

      const kept = fetchedChildren.find((child) => child.get('title') === 'second');
      if (!(kept instanceof Child)) throw new Error('Expected the second Child before relation replacement');
      fetched.set('children', [kept, independent]);
      await save(fetched);
      const replacedRow = row(await cursorResult(Parent, { $include: ['children'], $one: true, id: parent.id }));
      assert.deepStrictEqual(
        rows(replacedRow.children)
          .map((relatedRow) => relatedRow.title)
          .sort(),
        ['independent', 'second']
      );

      const allChildren = rows(await cursorResult(Child, { $sort: 'id' }));
      assert.strictEqual(allChildren.find((row) => row.id === first.id)?.parent_id, null);
      assert.strictEqual(allChildren.find((row) => row.id === second.id)?.parent_id, parent.id);
      assert.strictEqual(allChildren.find((row) => row.id === direct.id)?.parent_id, null);
      assert.strictEqual(allChildren.find((row) => row.id === independent.id)?.parent_id, parent.id);
      assert.strictEqual(allChildren.find((row) => row.id === otherChild.id)?.parent_id, otherParent.id);

      const invalidCursor = callStatic(Parent, 'cursor', [{ $include: ['missing'] }]);
      if (typeof invalidCursor !== 'object' || invalidCursor === null) throw new Error('Invalid relation cursor was not returned');
      let errorCalls = 0;
      const includeError = await new Promise<Error>((resolve, reject) => {
        const returned = callMethod(invalidCursor, 'toJSON', [
          function includeCallback(error: Error | null) {
            errorCalls += 1;
            if (!error) reject(new Error('Missing relation include unexpectedly succeeded'));
            else resolve(error);
          },
        ]);
        assert.strictEqual(returned, undefined);
      });
      await Promise.resolve();
      assert.strictEqual(errorCalls, 1);
      assert.match(includeError.message, /Included relation 'missing' is not a relation/);

      const parentDatabase = callStatic(Parent, 'db', []);
      if (typeof parentDatabase !== 'object' || parentDatabase === null) throw new Error('Parent database control was not returned');
      assert.strictEqual(Reflect.get(parentDatabase, 'connection'), Reflect.get(childDatabase, 'connection'));
    } finally {
      try {
        await closeModels(Parent, Child);
      } finally {
        BackboneSQL.configure({ model_cache: { enabled: false } });
        safeRmSync(root);
      }
    }
  });

  it('reuses cached parent and child identities for included models', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    BackboneSQL.configure({ model_cache: { enabled: true, max: 100 } });
    CachedParent.prototype.sync = BackboneSQL.sync(CachedParent, { filename });
    try {
      await callbackCompletion((callback) => callStatic(CachedParent, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(CachedChild, 'resetSchema', [{}, callback]));

      const child = new CachedChild({ title: 'cached-child' });
      const parent = new CachedParent({ children: [child], name: 'cached-parent' });
      await save(parent);

      const found = await callbackResult((callback) => callStatic(CachedParent, 'findOne', [{ id: parent.id }, callback]));
      assert.strictEqual(found, parent);
      const included = await cursorResult(CachedParent, { $include: ['children'], $one: true, id: parent.id }, 'toModels');
      assert.strictEqual(included, parent);
      const includedChildren = models(await related(parent, 'children'));
      assert.strictEqual(includedChildren[0], child);
    } finally {
      try {
        await closeModels(CachedParent, CachedChild);
      } finally {
        BackboneSQL.configure({ model_cache: { enabled: false } });
        safeRmSync(root);
      }
    }
  });

  it('persists, includes, replaces, nulls, and cleans up hasOne rows with cache disabled', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    BackboneSQL.configure({ model_cache: { enabled: false } });
    HasOneOwner.prototype.sync = BackboneSQL.sync(HasOneOwner, { filename });
    try {
      await callbackCompletion((callback) => callStatic(HasOneOwner, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(HasOneProfile, 'resetSchema', [{}, callback]));

      const profileDatabase = callStatic(HasOneProfile, 'db', []);
      if (typeof profileDatabase !== 'object' || profileDatabase === null) throw new Error('HasOneProfile database control was not returned');
      const profileSchema = Reflect.get(profileDatabase, 'schema');
      assert.strictEqual(await callMethod(profileSchema, 'hasColumn', ['owner_id']), true);

      const firstProfile = new HasOneProfile({ title: 'first-profile' });
      await save(firstProfile);
      const owner = new HasOneOwner({ name: 'primary-owner', profile: firstProfile });
      await save(owner);

      const independentProfile = new HasOneProfile({ title: 'independent-profile' });
      await save(independentProfile);
      const emptyOwner = new HasOneOwner({ name: 'empty-owner' });
      await save(emptyOwner);
      const otherProfile = new HasOneProfile({ title: 'other-profile' });
      await save(otherProfile);
      const otherOwner = new HasOneOwner({ name: 'other-owner', profile: otherProfile });
      await save(otherOwner);

      const found = await callbackResult((callback) => callStatic(HasOneOwner, 'findOne', [{ id: owner.id }, callback]));
      assert.ok(found instanceof HasOneOwner);
      assert.notStrictEqual(found, owner);

      const fetchedOwner = new HasOneOwner({ id: numericID(owner) });
      await fetch(fetchedOwner);
      const fetchedProfile = await related(fetchedOwner, 'profile');
      assert.ok(fetchedProfile instanceof HasOneProfile);
      assert.strictEqual(fetchedProfile.id, firstProfile.id);

      const fetchedFirstProfile = new HasOneProfile({ id: numericID(firstProfile) });
      await fetch(fetchedFirstProfile);
      const fetchedProfileOwner = await related(fetchedFirstProfile, 'owner');
      assert.ok(fetchedProfileOwner instanceof HasOneOwner);
      assert.strictEqual(fetchedProfileOwner.id, owner.id);

      const includedOwner = row(await cursorResult(HasOneOwner, { $include: ['profile'], $one: true, id: owner.id }));
      assert.strictEqual(row(includedOwner.profile).id, firstProfile.id);
      const includedEmptyOwner = row(await cursorResult(HasOneOwner, { $include: ['profile'], $one: true, id: emptyOwner.id }));
      assert.strictEqual(includedEmptyOwner.profile, null);

      const includedProfiles = rows(await cursorResult(HasOneProfile, { $include: ['owner'], $sort: 'id' }));
      assert.strictEqual(row(includedProfiles.find((value) => value.id === firstProfile.id)?.owner).id, owner.id);
      assert.strictEqual(includedProfiles.find((value) => value.id === independentProfile.id)?.owner, null);

      const replacementProfile = new HasOneProfile({ title: 'replacement-profile' });
      await save(replacementProfile);
      fetchedOwner.set('profile', replacementProfile);
      await save(fetchedOwner);
      const replacedOwner = row(await cursorResult(HasOneOwner, { $include: ['profile'], $one: true, id: owner.id }));
      assert.strictEqual(row(replacedOwner.profile).id, replacementProfile.id);

      let profileRows = rows(await cursorResult(HasOneProfile, { $sort: 'id' }));
      assert.strictEqual(profileRows.find((value) => value.id === firstProfile.id)?.owner_id, null);
      assert.strictEqual(profileRows.find((value) => value.id === replacementProfile.id)?.owner_id, owner.id);
      assert.strictEqual(profileRows.find((value) => value.id === independentProfile.id)?.owner_id, null);
      assert.strictEqual(profileRows.find((value) => value.id === otherProfile.id)?.owner_id, otherOwner.id);

      await patchRemove(fetchedOwner, 'profile');
      const nulledOwner = row(await cursorResult(HasOneOwner, { $include: ['profile'], $one: true, id: owner.id }));
      assert.strictEqual(nulledOwner.profile, null);
      profileRows = rows(await cursorResult(HasOneProfile, { $sort: 'id' }));
      assert.strictEqual(profileRows.find((value) => value.id === replacementProfile.id)?.owner_id, null);

      fetchedOwner.set('profile', replacementProfile);
      await save(fetchedOwner);
      let destroyCallbackCalls = 0;
      await new Promise<void>((resolve, reject) => {
        callMethod(fetchedOwner, 'destroy', [
          function destroyCallback(error: Error | null) {
            destroyCallbackCalls += 1;
            if (error) reject(error);
            else resolve();
          },
        ]);
      });
      await Promise.resolve();
      assert.strictEqual(destroyCallbackCalls, 1);
      assert.strictEqual(await cursorResult(HasOneOwner, { $one: true, id: owner.id }), null);
      profileRows = rows(await cursorResult(HasOneProfile, { $sort: 'id' }));
      assert.strictEqual(profileRows.find((value) => value.id === replacementProfile.id)?.owner_id, null);
      assert.strictEqual(profileRows.find((value) => value.id === otherProfile.id)?.owner_id, otherOwner.id);

      const duplicateOwner = new HasOneOwner({ name: 'duplicate-owner' });
      await save(duplicateOwner);
      const duplicateA = new HasOneProfile({ owner: duplicateOwner, title: 'duplicate-a' });
      const duplicateB = new HasOneProfile({ owner: duplicateOwner, title: 'duplicate-b' });
      await save(duplicateA);
      await save(duplicateB);
      const duplicateIncluded = row(await cursorResult(HasOneOwner, { $include: ['profile'], $one: true, id: duplicateOwner.id }));
      const duplicateIncludedID = row(duplicateIncluded.profile).id;
      assert.ok(duplicateIncludedID === duplicateA.id || duplicateIncludedID === duplicateB.id, 'hasOne duplicate selection must remain an unspecified matching row');

      await callMethod(profileSchema, 'dropTable', []);
      const failingCursor = callStatic(HasOneOwner, 'cursor', [{ $include: ['profile'], id: otherOwner.id }]);
      if (typeof failingCursor !== 'object' || failingCursor === null) throw new Error('Failing hasOne cursor was not returned');
      let errorCallbackCalls = 0;
      const databaseError = await new Promise<Error>((resolve, reject) => {
        const returned = callMethod(failingCursor, 'toJSON', [
          function includeCallback(error: Error | null, value?: unknown) {
            errorCallbackCalls += 1;
            if (!error) reject(new Error(`Missing hasOne table returned rows: ${JSON.stringify(value)}`));
            else resolve(error);
          },
        ]);
        assert.strictEqual(returned, undefined);
      });
      await Promise.resolve();
      assert.strictEqual(errorCallbackCalls, 1);
      assert.strictEqual(Reflect.get(databaseError, 'code'), 'SQLITE_ERROR');
    } finally {
      try {
        await closeModels(HasOneOwner, HasOneProfile);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('reuses cached hasOne identities and preserves null includes', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    BackboneSQL.configure({ model_cache: { enabled: true, max: 100 } });
    CachedHasOneOwner.prototype.sync = BackboneSQL.sync(CachedHasOneOwner, { filename });
    try {
      await callbackCompletion((callback) => callStatic(CachedHasOneOwner, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(CachedHasOneProfile, 'resetSchema', [{}, callback]));

      const profile = new CachedHasOneProfile({ title: 'cached-profile' });
      const owner = new CachedHasOneOwner({ name: 'cached-owner', profile });
      await save(owner);
      const emptyOwner = new CachedHasOneOwner({ name: 'cached-empty-owner' });
      await save(emptyOwner);

      const found = await callbackResult((callback) => callStatic(CachedHasOneOwner, 'findOne', [{ id: owner.id }, callback]));
      assert.strictEqual(found, owner);
      const included = await cursorResult(CachedHasOneOwner, { $include: ['profile'], $one: true, id: owner.id }, 'toModels');
      assert.strictEqual(included, owner);
      assert.strictEqual(await related(owner, 'profile'), profile);

      const includedEmpty = await cursorResult(CachedHasOneOwner, { $include: ['profile'], $one: true, id: emptyOwner.id }, 'toModels');
      assert.strictEqual(includedEmpty, emptyOwner);
      assert.strictEqual(await related(emptyOwner, 'profile'), null);
    } finally {
      try {
        await closeModels(CachedHasOneOwner, CachedHasOneProfile);
      } finally {
        BackboneSQL.configure({ model_cache: { enabled: false } });
        safeRmSync(root);
      }
    }
  });

  it('filters one-hop relations without duplicating parent rows', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    BackboneSQL.configure({ model_cache: { enabled: false } });
    PredicateParent.prototype.sync = BackboneSQL.sync(PredicateParent, { filename });
    try {
      await callbackCompletion((callback) => callStatic(PredicateParent, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(PredicateChild, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(PredicateProfile, 'resetSchema', [{}, callback]));

      const matchingParent = new PredicateParent({ active: true, name: 'matching-parent' });
      const secondParent = new PredicateParent({ active: true, name: 'second-parent' });
      const splitParent = new PredicateParent({ active: true, name: 'split-parent' });
      const inactiveParent = new PredicateParent({ active: false, name: 'inactive-parent' });
      const unrelatedParent = new PredicateParent({ active: true, name: 'unrelated-parent' });
      for (const parent of [matchingParent, secondParent, splitParent, inactiveParent, unrelatedParent]) await save(parent);

      const bindingTitle = "quoted' OR 1=1 --";
      const children = [
        new PredicateChild({ parent: matchingParent, score: 10, title: 'match-a' }),
        new PredicateChild({ parent: matchingParent, score: 20, title: 'match-b' }),
        new PredicateChild({ parent: matchingParent, score: 5, title: bindingTitle }),
        new PredicateChild({ parent: secondParent, score: 30, title: 'match-c' }),
        new PredicateChild({ parent: secondParent, score: 1, title: 'second-extra' }),
        new PredicateChild({ parent: splitParent, score: 1, title: 'split-title' }),
        new PredicateChild({ parent: splitParent, score: 50, title: 'split-score' }),
        new PredicateChild({ parent: inactiveParent, score: 40, title: 'match-inactive' }),
        new PredicateChild({ score: 100, title: 'independent' }),
      ];
      for (const child of children) await save(child);

      const matchingProfile = new PredicateProfile({ label: 'ready', owner: matchingParent });
      const secondProfile = new PredicateProfile({ label: 'waiting', owner: secondParent });
      await save(matchingProfile);
      await save(secondProfile);

      const matchingQuery = {
        active: true,
        'children.score': { $gte: 10 },
        'children.title': { $in: ['match-a', 'match-b', 'match-c', 'split-title', 'match-inactive'] },
      };
      const matchedParents = rows(await cursorResult(PredicateParent, { ...matchingQuery, $sort: 'id' }));
      assert.deepStrictEqual(
        matchedParents.map((value) => value.id),
        [matchingParent.id, secondParent.id]
      );

      assert.strictEqual(await callbackResult((callback) => callStatic(PredicateParent, 'count', [matchingQuery, callback])), 2);
      assert.strictEqual(await callbackResult((callback) => callStatic(PredicateParent, 'exists', [{ ...matchingQuery, name: 'matching-parent' }, callback])), true);
      assert.strictEqual(await callbackResult((callback) => callStatic(PredicateParent, 'exists', [{ ...matchingQuery, name: 'unrelated-parent' }, callback])), false);

      const page = row(await cursorResult(PredicateParent, { ...matchingQuery, $limit: 1, $offset: 1, $page: true, $sort: 'id' }));
      assert.strictEqual(page.offset, 1);
      assert.strictEqual(page.total_rows, 2);
      assert.deepStrictEqual(
        rows(page.rows).map((value) => value.id),
        [secondParent.id]
      );

      const included = row(
        await cursorResult(PredicateParent, {
          $include: ['children'],
          $one: true,
          'children.score': { $gte: 20 },
          id: matchingParent.id,
        })
      );
      assert.deepStrictEqual(
        rows(included.children)
          .map((value) => value.title)
          .sort(),
        [bindingTitle, 'match-a', 'match-b'].sort()
      );

      const belongsToRows = rows(await cursorResult(PredicateChild, { $sort: 'id', 'parent.name': 'matching-parent', score: { $gte: 10 } }));
      assert.deepStrictEqual(
        belongsToRows.map((value) => value.title),
        ['match-a', 'match-b']
      );
      const hasOneRows = rows(await cursorResult(PredicateParent, { active: true, 'profile.label': 'ready' }));
      assert.deepStrictEqual(
        hasOneRows.map((value) => value.id),
        [matchingParent.id]
      );

      // Related predicates inside $or are an intentional extension: the retained cursor parsed them but did not apply them.
      const mixedOrRows = rows(
        await cursorResult(PredicateParent, {
          $or: [{ name: 'second-parent' }, { 'profile.label': 'ready' }],
          $sort: 'id',
          active: true,
        })
      );
      assert.deepStrictEqual(
        mixedOrRows.map((value) => value.id),
        [matchingParent.id, secondParent.id]
      );

      assert.deepStrictEqual(rows(await cursorResult(PredicateParent, { 'children.title': { $in: [] } })), []);
      const emptyRelatedOrRows = rows(
        await cursorResult(PredicateParent, {
          $or: [{ 'children.title': { $in: [] }, name: 'matching-parent' }, { name: 'second-parent' }],
        })
      );
      assert.deepStrictEqual(
        emptyRelatedOrRows.map((value) => value.id),
        [secondParent.id]
      );

      const boundRows = rows(await cursorResult(PredicateParent, { 'children.title': bindingTitle }));
      assert.deepStrictEqual(
        boundRows.map((value) => value.id),
        [matchingParent.id]
      );

      const invalidCursor = callStatic(PredicateParent, 'cursor', [{ 'children.title; drop table predicate_children': 'match-a' }]);
      if (typeof invalidCursor !== 'object' || invalidCursor === null) throw new Error('Invalid dotted-predicate cursor was not returned');
      let invalidCallbackCalls = 0;
      const invalidError = await new Promise<Error>((resolve, reject) => {
        const returned = callMethod(invalidCursor, 'toJSON', [
          function invalidPredicateCallback(error: Error | null, value?: unknown) {
            invalidCallbackCalls += 1;
            if (!error) reject(new Error(`Invalid related identifier returned rows: ${JSON.stringify(value)}`));
            else resolve(error);
          },
        ]);
        assert.strictEqual(returned, undefined);
      });
      await Promise.resolve();
      assert.strictEqual(invalidCallbackCalls, 1);
      assert.match(invalidError.message, /Related query field is invalid/);
      assert.strictEqual(rows(await cursorResult(PredicateChild, {})).length, children.length);

      await assert.rejects(cursorResult(PredicateParent, { 'children.parent.name': 'matching-parent' }), /SQLite relation query supports one hop/);
    } finally {
      try {
        await closeModels(PredicateParent, PredicateChild, PredicateProfile);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('projects parent fields while including every SQLite relation family', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    BackboneSQL.configure({ model_cache: { enabled: false } });
    ProjectionParent.prototype.sync = BackboneSQL.sync(ProjectionParent, { filename });
    try {
      await callbackCompletion((callback) => callStatic(ProjectionParent, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(ProjectionChild, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(ProjectionProfile, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(ProjectionTag, 'resetSchema', [{}, callback]));

      const first = new ProjectionParent({ group: 'a', name: 'alpha', priority: 1 });
      const empty = new ProjectionParent({ group: 'b', name: 'beta', priority: 2 });
      const representative = new ProjectionParent({ group: 'a', name: 'gamma', priority: 3 });
      for (const parent of [first, empty, representative]) await save(parent);

      const firstChildA = new ProjectionChild({ parent: first, title: 'alpha-child-a' });
      const firstChildB = new ProjectionChild({ parent: first, title: 'alpha-child-b' });
      const representativeChild = new ProjectionChild({ parent: representative, title: 'gamma-child' });
      const independentChild = new ProjectionChild({ title: 'independent-child' });
      for (const child of [firstChildA, firstChildB, representativeChild, independentChild]) await save(child);

      const firstProfile = new ProjectionProfile({ label: 'alpha-profile', owner: first });
      await save(firstProfile);
      const firstTag = new ProjectionTag({ label: 'first-tag' });
      const sharedTag = new ProjectionTag({ label: 'shared-tag' });
      await save(firstTag);
      await save(sharedTag);
      await patchAdd(first, 'tags', firstTag);
      await patchAdd(first, 'tags', sharedTag);
      await patchAdd(representative, 'tags', sharedTag);

      const selected = row(
        await cursorResult(ProjectionParent, {
          $include: ['children', 'profile', 'tags'],
          $one: true,
          $select: ['name'],
          id: first.id,
        })
      );
      assert.deepStrictEqual(Object.keys(selected).sort(), ['children', 'name', 'profile', 'tags']);
      assert.strictEqual(selected.name, 'alpha');
      assert.deepStrictEqual(
        rows(selected.children)
          .map((child) => child.title)
          .sort(),
        ['alpha-child-a', 'alpha-child-b']
      );
      assert.strictEqual(row(selected.profile).label, 'alpha-profile');
      assert.deepStrictEqual(
        rows(selected.tags)
          .map((tag) => tag.label)
          .sort(),
        ['first-tag', 'shared-tag']
      );
      assert.strictEqual(Reflect.has(selected, 'id'), false);

      const selectedEmpty = row(
        await cursorResult(ProjectionParent, {
          $include: ['children', 'profile', 'tags'],
          $one: true,
          $select: ['name'],
          id: empty.id,
        })
      );
      assert.deepStrictEqual(selectedEmpty, { children: [], name: 'beta', profile: null, tags: [] });

      const childRows = rows(
        await cursorResult(ProjectionChild, {
          $include: ['parent'],
          $select: ['title'],
          $sort: 'title',
        })
      );
      assert.deepStrictEqual(
        childRows.map((child) => ({ keys: Object.keys(child).sort(), parent: child.parent ? row(child.parent).name : null, title: child.title })),
        [
          { keys: ['parent', 'title'], parent: 'alpha', title: 'alpha-child-a' },
          { keys: ['parent', 'title'], parent: 'alpha', title: 'alpha-child-b' },
          { keys: ['parent', 'title'], parent: 'gamma', title: 'gamma-child' },
          { keys: ['parent', 'title'], parent: null, title: 'independent-child' },
        ]
      );

      const page = row(
        await cursorResult(ProjectionParent, {
          $include: ['tags'],
          $limit: 1,
          $offset: 1,
          $page: true,
          $select: ['name'],
          $sort: 'name',
        })
      );
      assert.strictEqual(page.offset, 1);
      assert.strictEqual(page.total_rows, 3);
      assert.deepStrictEqual(page.rows, [{ name: 'beta', tags: [] }]);

      const unique = rows(
        await cursorResult(ProjectionParent, {
          $include: ['children', 'profile', 'tags'],
          $select: ['group', 'name', 'priority'],
          $sort: ['group', '-priority'],
          $unique: ['group'],
        })
      );
      assert.deepStrictEqual(
        unique.map((parent) => ({
          children: rows(parent.children).map((child) => child.title),
          group: parent.group,
          keys: Object.keys(parent).sort(),
          name: parent.name,
          priority: parent.priority,
          profile: parent.profile,
          tags: rows(parent.tags).map((tag) => tag.label),
        })),
        [
          {
            children: ['gamma-child'],
            group: 'a',
            keys: ['children', 'group', 'name', 'priority', 'profile', 'tags'],
            name: 'gamma',
            priority: 3,
            profile: null,
            tags: ['shared-tag'],
          },
          {
            children: [],
            group: 'b',
            keys: ['children', 'group', 'name', 'priority', 'profile', 'tags'],
            name: 'beta',
            priority: 2,
            profile: null,
            tags: [],
          },
        ]
      );

      const uniqueWithFullParentRows = rows(
        await cursorResult(ProjectionParent, {
          $include: ['tags'],
          $sort: ['group', '-priority'],
          $unique: ['group'],
        })
      );
      assert.deepStrictEqual(
        uniqueWithFullParentRows.map((parent) => ({
          group: parent.group,
          name: parent.name,
          priority: parent.priority,
          tags: rows(parent.tags).map((tag) => tag.label),
        })),
        [
          { group: 'a', name: 'gamma', priority: 3, tags: ['shared-tag'] },
          { group: 'b', name: 'beta', priority: 2, tags: [] },
        ]
      );

      let valuesIncludeCallbackCalls = 0;
      const valuesInclude = await new Promise<unknown>((resolve, reject) => {
        const cursor = callStatic(ProjectionParent, 'cursor', [
          {
            $include: ['children', 'profile', 'tags'],
            $sort: 'name',
            $values: ['name'],
          },
        ]);
        if (typeof cursor !== 'object' || cursor === null) throw new Error('Values/include cursor was not returned');
        const returned = callMethod(cursor, 'toJSON', [
          function valuesIncludeCallback(error: Error | null, value?: unknown) {
            valuesIncludeCallbackCalls += 1;
            if (error) reject(error);
            else resolve(value);
          },
        ]);
        assert.strictEqual(returned, undefined);
      });
      await Promise.resolve();
      assert.strictEqual(valuesIncludeCallbackCalls, 1);
      assert.deepStrictEqual(valuesInclude, ['alpha', 'beta', 'gamma']);

      assert.deepStrictEqual(
        await cursorResult(ProjectionParent, {
          $include: ['children'],
          $sort: 'name',
          $values: ['name', 'priority'],
        }),
        [
          ['alpha', 1],
          ['beta', 2],
          ['gamma', 3],
        ]
      );
      assert.strictEqual(
        await cursorResult(ProjectionParent, {
          $include: ['children'],
          $one: true,
          $values: ['name'],
          id: first.id,
        }),
        'alpha'
      );
      assert.strictEqual(
        await cursorResult(ProjectionParent, {
          $include: ['children'],
          $one: true,
          $values: ['name'],
          id: 999_999,
        }),
        null
      );
      assert.deepStrictEqual(
        await cursorResult(ProjectionParent, {
          $include: ['children'],
          $values: ['name'],
          id: 999_999,
        }),
        []
      );
      assert.deepStrictEqual(
        await cursorResult(ProjectionParent, {
          $include: ['children'],
          $limit: 1,
          $offset: 1,
          $page: true,
          $sort: 'name',
          $values: ['name'],
        }),
        { offset: 1, rows: ['beta'], total_rows: 3 }
      );
      assert.deepStrictEqual(
        await cursorResult(ProjectionChild, {
          $include: ['parent'],
          $sort: 'title',
          $values: ['title'],
        }),
        ['alpha-child-a', 'alpha-child-b', 'gamma-child', 'independent-child']
      );

      const tiedRepresentative = new ProjectionParent({ group: 'a', name: 'gamma-later', priority: 3 });
      await save(tiedRepresentative);
      const database = schemaDatabase(schemaControl(ProjectionParent));
      const nativeQuery = callMethod(database, 'select', ['id', 'group', 'name', 'priority']);
      if (typeof nativeQuery !== 'object' || nativeQuery === null) throw new Error('Expected a native SQLite query builder');
      callMethod(nativeQuery, 'from', ['projection_parents']);
      const nativeRows = rows(await callMethod(nativeQuery, 'orderBy', ['id']));
      assert.deepStrictEqual(nativeRows, [
        { group: 'a', id: numericID(first), name: 'alpha', priority: 1 },
        { group: 'b', id: numericID(empty), name: 'beta', priority: 2 },
        { group: 'a', id: numericID(representative), name: 'gamma', priority: 3 },
        { group: 'a', id: numericID(tiedRepresentative), name: 'gamma-later', priority: 3 },
      ]);
      assert.ok(numericID(representative) < numericID(tiedRepresentative));
      assert.deepStrictEqual(await cursorResult(ProjectionParent, { $unique: ['group'], $sort: ['group', '-priority'], $select: ['name', 'priority'] }), [
        { name: 'gamma', priority: 3 },
        { name: 'beta', priority: 2 },
      ]);
      assert.deepStrictEqual(await cursorResult(ProjectionParent, { $unique: ['group'], $sort: ['group', '-priority'], $select: ['id'] }), [
        { id: numericID(representative) },
        { id: numericID(empty) },
      ]);
      assert.deepStrictEqual(await cursorResult(ProjectionParent, { $unique: ['group'], $sort: ['group', '-priority'], $select: ['name'] }), [{ name: 'gamma' }, { name: 'beta' }]);
      assert.deepStrictEqual(await cursorResult(ProjectionParent, { $unique: ['group'], $select: ['name'] }), [{ name: 'alpha' }, { name: 'beta' }]);
      assert.deepStrictEqual(await cursorResult(ProjectionParent, { $unique: ['group'], $sort: ['group', '-priority'], $values: ['name'] }), ['gamma', 'beta']);
      assert.deepStrictEqual(await cursorResult(ProjectionParent, { $unique: ['group'], $sort: ['group', '-priority'], $select: ['name'], $page: true, $limit: 1, $offset: 1 }), {
        offset: 1,
        rows: [{ name: 'beta' }],
        total_rows: 2,
      });
      assert.deepStrictEqual(await cursorResult(ProjectionParent, { priority: { $lte: 2 }, $unique: ['group'], $sort: '-priority', $select: ['name'], $page: true }), {
        offset: 0,
        rows: [{ name: 'beta' }, { name: 'alpha' }],
        total_rows: 2,
      });
      const unchangedQuery = callMethod(database, 'select', ['id', 'group', 'name', 'priority']);
      if (typeof unchangedQuery !== 'object' || unchangedQuery === null) throw new Error('Expected a native SQLite query builder');
      callMethod(unchangedQuery, 'from', ['projection_parents']);
      assert.deepStrictEqual(rows(await callMethod(unchangedQuery, 'orderBy', ['id'])), nativeRows);

      const profileDatabase = callStatic(ProjectionProfile, 'db', []);
      if (typeof profileDatabase !== 'object' || profileDatabase === null) throw new Error('ProjectionProfile database control was not returned');
      const profileSchema: unknown = Reflect.get(profileDatabase, 'schema');
      if (typeof profileSchema !== 'object' || profileSchema === null) throw new Error('ProjectionProfile schema control was not returned');
      const dropTableIfExists: unknown = Reflect.get(profileSchema, 'dropTableIfExists');
      if (typeof dropTableIfExists !== 'function') throw new Error('ProjectionProfile schema cannot drop its table');
      await Reflect.apply(dropTableIfExists, profileSchema, []);

      let databaseErrorCallbackCalls = 0;
      const databaseError = await new Promise<Error>((resolve, reject) => {
        const cursor = callStatic(ProjectionParent, 'cursor', [{ $include: ['profile'], $select: ['name'] }]);
        if (typeof cursor !== 'object' || cursor === null) throw new Error('Projection/include database-error cursor was not returned');
        const returned = callMethod(cursor, 'toJSON', [
          function projectionIncludeDatabaseErrorCallback(error: Error | null, value?: unknown) {
            databaseErrorCallbackCalls += 1;
            if (!error) reject(new Error(`Missing projection relation table returned rows: ${JSON.stringify(value)}`));
            else resolve(error);
          },
        ]);
        assert.strictEqual(returned, undefined);
      });
      await Promise.resolve();
      assert.strictEqual(databaseErrorCallbackCalls, 1);
      assert.strictEqual(Reflect.get(databaseError, 'code'), 'SQLITE_ERROR');

      let valuesDatabaseErrorCallbackCalls = 0;
      const valuesDatabaseError = await new Promise<Error>((resolve, reject) => {
        const cursor = callStatic(ProjectionParent, 'cursor', [{ $include: ['profile'], $values: ['name'] }]);
        if (typeof cursor !== 'object' || cursor === null) throw new Error('Values/include database-error cursor was not returned');
        const returned = callMethod(cursor, 'toJSON', [
          function valuesIncludeDatabaseErrorCallback(error: Error | null, value?: unknown) {
            valuesDatabaseErrorCallbackCalls += 1;
            if (!error) reject(new Error(`Missing values relation table returned rows: ${JSON.stringify(value)}`));
            else resolve(error);
          },
        ]);
        assert.strictEqual(returned, undefined);
      });
      await Promise.resolve();
      assert.strictEqual(valuesDatabaseErrorCallbackCalls, 1);
      assert.strictEqual(Reflect.get(valuesDatabaseError, 'code'), 'SQLITE_ERROR');
    } finally {
      try {
        await closeModels(ProjectionParent, ProjectionChild, ProjectionProfile, ProjectionTag);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('rejects an unknown relation before querying an absent parent table', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    class MissingRelationParent extends BackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3:///missing_relation_parents';

      schema(): Record<string, unknown> {
        return { name: ['String', { nullable: false }] };
      }
    }

    BackboneSQL.configure({ model_cache: { enabled: false } });
    MissingRelationParent.prototype.sync = BackboneSQL.sync(MissingRelationParent, { filename });
    try {
      const cursor = callStatic(MissingRelationParent, 'cursor', [{ 'missing.title': 'match-a' }]);
      if (typeof cursor !== 'object' || cursor === null) throw new Error('Unknown-relation cursor was not returned');
      let callbackCalls = 0;
      const error = await new Promise<Error>((resolve, reject) => {
        const returned = callMethod(cursor, 'toJSON', [
          function unknownRelationCallback(callbackError: Error | null, value?: unknown) {
            callbackCalls += 1;
            if (!callbackError) reject(new Error(`Unknown relation queried an absent table: ${JSON.stringify(value)}`));
            else resolve(callbackError);
          },
        ]);
        assert.strictEqual(returned, undefined);
      });
      await Promise.resolve();
      assert.strictEqual(callbackCalls, 1);
      assert.match(error.message, /Included relation 'missing' is not a relation/);
    } finally {
      try {
        await closeModels(MissingRelationParent);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('rejects self relations before SQLite execution', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    class SelfNode extends BackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3:///self_nodes';

      schema(): Record<string, unknown> {
        return {
          name: ['String', { nullable: false }],
          parent: () => ['belongsTo', SelfNode],
        };
      }
    }

    BackboneSQL.configure({ model_cache: { enabled: false } });
    try {
      assert.throws(() => BackboneSQL.sync(SelfNode, { filename }), /SQLite self relations are not implemented/);
    } finally {
      try {
        await closeModels(SelfNode);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('persists and includes a CJS child related to an ESM parent on one SQLite connection', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    class MixedChild extends CJSBackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3:///mixed_relation_children';

      schema(): Record<string, unknown> {
        return {
          mixed_relation_parent_id: ['Integer', { nullable: true }],
          title: ['String', { nullable: false }],
        };
      }
    }

    class MixedParent extends BackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3:///mixed_relation_parents';

      schema(): Record<string, unknown> {
        return {
          children: () => ['hasMany', MixedChild, { as: 'parent' }],
          name: ['String', { nullable: false }],
        };
      }
    }

    BackboneSQL.configure({ model_cache: { enabled: false } });
    MixedChild.prototype.sync = CJSBackboneSQL.sync(MixedChild, { filename });
    MixedParent.prototype.sync = BackboneSQL.sync(MixedParent, { filename });
    try {
      await callbackCompletion((callback) => callStatic(MixedChild, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(MixedParent, 'resetSchema', [{}, callback]));

      const child = new MixedChild({ title: 'cjs-child' });
      await save(child);
      const parent = new MixedParent({ children: [child], name: 'esm-parent' });
      await save(parent);

      const parentDatabase = callStatic(MixedParent, 'db', []);
      const childDatabase = callStatic(MixedChild, 'db', []);
      if (typeof parentDatabase !== 'object' || parentDatabase === null) throw new Error('MixedParent database control was not returned');
      if (typeof childDatabase !== 'object' || childDatabase === null) throw new Error('MixedChild database control was not returned');
      assert.strictEqual(Reflect.get(parentDatabase, 'connection'), Reflect.get(childDatabase, 'connection'));

      const included = row(await cursorResult(MixedParent, { $include: ['children'], $one: true, id: parent.id }));
      assert.deepStrictEqual(
        rows(included.children).map((value) => value.title),
        ['cjs-child']
      );
      assert.strictEqual(rows(included.children)[0]?.mixed_relation_parent_id, parent.id);
      const filtered = rows(await cursorResult(MixedParent, { 'children.title': 'cjs-child' }));
      assert.deepStrictEqual(
        filtered.map((value) => value.id),
        [parent.id]
      );
    } finally {
      try {
        await closeModels(MixedParent, MixedChild);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('rejects includes across independently configured SQLite files before reading a colliding table', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const parentFilename = path.join(root, 'parent.sqlite3');
    const childFilename = path.join(root, 'child.sqlite3');
    mkdirSync(root, { recursive: true });

    class CrossChild extends BackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3://cross_child_file/cross_children';

      schema(): Record<string, unknown> {
        return {
          cross_parent_id: ['Integer', { nullable: true }],
          title: ['String', { nullable: false }],
        };
      }
    }

    class CrossParent extends BackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3://cross_parent_file/cross_parents';

      schema(): Record<string, unknown> {
        return {
          children: () => ['hasMany', CrossChild, { as: 'parent' }],
          name: ['String', { nullable: false }],
        };
      }
    }

    class ParentFileCollision extends BackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3://cross_parent_file/cross_children';

      schema(): Record<string, unknown> {
        return {
          cross_parent_id: ['Integer', { nullable: true }],
          title: ['String', { nullable: false }],
        };
      }
    }

    BackboneSQL.configure({ model_cache: { enabled: false } });
    CrossChild.prototype.sync = BackboneSQL.sync(CrossChild, { filename: childFilename });
    CrossParent.prototype.sync = BackboneSQL.sync(CrossParent, { filename: parentFilename });
    ParentFileCollision.prototype.sync = BackboneSQL.sync(ParentFileCollision, { filename: parentFilename });
    try {
      await callbackCompletion((callback) => callStatic(CrossChild, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(CrossParent, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(ParentFileCollision, 'resetSchema', [{}, callback]));

      const childDatabase = callStatic(CrossChild, 'db', []);
      const parentDatabase = callStatic(CrossParent, 'db', []);
      const collisionDatabase = callStatic(ParentFileCollision, 'db', []);
      if (typeof childDatabase !== 'object' || childDatabase === null) throw new Error('CrossChild database control was not returned');
      if (typeof parentDatabase !== 'object' || parentDatabase === null) throw new Error('CrossParent database control was not returned');
      if (typeof collisionDatabase !== 'object' || collisionDatabase === null) throw new Error('ParentFileCollision database control was not returned');
      assert.notStrictEqual(Reflect.get(childDatabase, 'connection'), Reflect.get(parentDatabase, 'connection'));
      assert.strictEqual(Reflect.get(collisionDatabase, 'connection'), Reflect.get(parentDatabase, 'connection'));
      assert.strictEqual(Reflect.get(Reflect.get(childDatabase, 'connection'), 'filename'), childFilename);
      assert.strictEqual(Reflect.get(Reflect.get(parentDatabase, 'connection'), 'filename'), parentFilename);

      const parent = new CrossParent({ name: 'parent-file-row' });
      await save(parent);
      const childFileRow = new CrossChild({ cross_parent_id: parent.id, title: 'child-file-row' });
      const parentFileRow = new ParentFileCollision({ cross_parent_id: parent.id, title: 'parent-file-collision' });
      await save(childFileRow);
      await save(parentFileRow);
      assert.strictEqual(childFileRow.id, parentFileRow.id);

      const registeredChildSync = CrossChild.prototype.sync;
      let activeSyncCallbackCalls = 0;
      const activeSyncError = await (async () => {
        try {
          CrossChild.prototype.sync = BackboneSQL.Backbone.sync;
          return await new Promise<Error>((resolve, reject) => {
            const cursor = callStatic(CrossParent, 'cursor', [{ $include: ['children'], id: parent.id }]);
            if (typeof cursor !== 'object' || cursor === null) throw new Error('Active-sync ownership cursor was not returned');
            const returned = callMethod(cursor, 'toJSON', [
              function includeCallback(error: Error | null, value?: unknown) {
                activeSyncCallbackCalls += 1;
                if (!error) reject(new Error(`Foreign active sync returned unrelated rows: ${JSON.stringify(value)}`));
                else resolve(error);
              },
            ]);
            assert.strictEqual(returned, undefined);
          });
        } finally {
          CrossChild.prototype.sync = registeredChildSync;
        }
      })();
      await Promise.resolve();
      assert.strictEqual(activeSyncCallbackCalls, 1);
      assert.match(activeSyncError.message, /SQLite related model is no longer configured by this adapter/);

      let activePredicateCallbackCalls = 0;
      const activePredicateError = await (async () => {
        try {
          CrossChild.prototype.sync = BackboneSQL.Backbone.sync;
          return await new Promise<Error>((resolve, reject) => {
            const cursor = callStatic(CrossParent, 'cursor', [{ 'children.title': 'child-file-row' }]);
            if (typeof cursor !== 'object' || cursor === null) throw new Error('Active-sync dotted-predicate cursor was not returned');
            const returned = callMethod(cursor, 'toJSON', [
              function predicateCallback(error: Error | null, value?: unknown) {
                activePredicateCallbackCalls += 1;
                if (!error) reject(new Error(`Foreign active sync returned dotted-predicate rows: ${JSON.stringify(value)}`));
                else resolve(error);
              },
            ]);
            assert.strictEqual(returned, undefined);
          });
        } finally {
          CrossChild.prototype.sync = registeredChildSync;
        }
      })();
      await Promise.resolve();
      assert.strictEqual(activePredicateCallbackCalls, 1);
      assert.match(activePredicateError.message, /SQLite related model is no longer configured by this adapter/);

      let callbackCalls = 0;
      const includeError = await new Promise<Error>((resolve, reject) => {
        const cursor = callStatic(CrossParent, 'cursor', [{ $include: ['children'], id: parent.id }]);
        if (typeof cursor !== 'object' || cursor === null) throw new Error('Cross-database cursor was not returned');
        const returned = callMethod(cursor, 'toJSON', [
          function includeCallback(error: Error | null, value?: unknown) {
            callbackCalls += 1;
            if (!error) reject(new Error(`Cross-database include returned unrelated rows: ${JSON.stringify(value)}`));
            else resolve(error);
          },
        ]);
        assert.strictEqual(returned, undefined);
      });
      await Promise.resolve();
      assert.strictEqual(callbackCalls, 1);
      assert.match(includeError.message, /SQLite cross-database relations are not implemented/);

      let predicateCallbackCalls = 0;
      const predicateError = await new Promise<Error>((resolve, reject) => {
        const cursor = callStatic(CrossParent, 'cursor', [{ 'children.title': 'child-file-row' }]);
        if (typeof cursor !== 'object' || cursor === null) throw new Error('Cross-database dotted-predicate cursor was not returned');
        const returned = callMethod(cursor, 'toJSON', [
          function predicateCallback(error: Error | null, value?: unknown) {
            predicateCallbackCalls += 1;
            if (!error) reject(new Error(`Cross-database dotted predicate returned unrelated rows: ${JSON.stringify(value)}`));
            else resolve(error);
          },
        ]);
        assert.strictEqual(returned, undefined);
      });
      await Promise.resolve();
      assert.strictEqual(predicateCallbackCalls, 1);
      assert.match(predicateError.message, /SQLite cross-database relations are not implemented/);
      assert.deepStrictEqual(
        rows(await cursorResult(CrossChild, {})).map((value) => value.title),
        ['child-file-row']
      );
      assert.deepStrictEqual(
        rows(await cursorResult(ParentFileCollision, {})).map((value) => value.title),
        ['parent-file-collision']
      );
    } finally {
      try {
        await closeModels(CrossParent, ParentFileCollision, CrossChild);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('persists, replaces, detaches, includes, and cleans up many-to-many links with cache disabled', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    BackboneSQL.configure({ model_cache: { enabled: false } });
    ManyStudent.prototype.sync = BackboneSQL.sync(ManyStudent, { filename });
    try {
      await callbackCompletion((callback) => callStatic(ManyStudent, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(ManyCourse, 'resetSchema', [{}, callback]));

      const links = joinTable(ManyStudent, 'courses');
      const studentDatabase = callStatic(ManyStudent, 'db', []);
      const courseDatabase = callStatic(ManyCourse, 'db', []);
      const linkDatabase = callStatic(links, 'db', []);
      if (typeof studentDatabase !== 'object' || studentDatabase === null) throw new Error('ManyStudent database control was not returned');
      if (typeof courseDatabase !== 'object' || courseDatabase === null) throw new Error('ManyCourse database control was not returned');
      if (typeof linkDatabase !== 'object' || linkDatabase === null) throw new Error('Many-to-many join database control was not returned');
      assert.strictEqual(Reflect.get(studentDatabase, 'connection'), Reflect.get(courseDatabase, 'connection'));
      assert.strictEqual(Reflect.get(studentDatabase, 'connection'), Reflect.get(linkDatabase, 'connection'));

      const courseA = new ManyCourse({ title: 'course-a' });
      const courseB = new ManyCourse({ title: 'course-b' });
      const courseC = new ManyCourse({ title: 'course-c' });
      for (const course of [courseA, courseB, courseC]) await save(course);

      const firstStudent = new ManyStudent({ courses: [courseA, courseB], name: 'first-student' });
      await save(firstStudent);
      assert.strictEqual(await callbackResult((callback) => callStatic(links, 'count', [callback])), 2);

      const firstIncluded = row(await cursorResult(ManyStudent, { $include: ['courses'], $one: true, id: firstStudent.id }));
      assert.deepStrictEqual(
        rows(firstIncluded.courses)
          .map((value) => value.title)
          .sort(),
        ['course-a', 'course-b']
      );
      const fetchedStudent = new ManyStudent({ id: numericID(firstStudent) });
      await fetch(fetchedStudent);
      assert.deepStrictEqual(
        models(await related(fetchedStudent, 'courses'))
          .map((model) => model.get('title'))
          .sort(),
        ['course-a', 'course-b']
      );
      const courseIncluded = row(await cursorResult(ManyCourse, { $include: ['students'], $one: true, id: courseA.id }));
      assert.deepStrictEqual(
        rows(courseIncluded.students).map((value) => value.id),
        [firstStudent.id]
      );

      let duplicateCallbackCalls = 0;
      const duplicateError = await new Promise<Error>((resolve, reject) => {
        callMethod(firstStudent, 'patchAdd', [
          'courses',
          courseA,
          function duplicateCallback(error: Error | null) {
            duplicateCallbackCalls += 1;
            if (!error) reject(new Error('Duplicate many-to-many link unexpectedly succeeded'));
            else resolve(error);
          },
        ]);
      });
      await Promise.resolve();
      assert.strictEqual(duplicateCallbackCalls, 1);
      assert.match(duplicateError.message, /Join already exists/);
      assert.strictEqual(await callbackResult((callback) => callStatic(links, 'count', [callback])), 2);

      firstStudent.set({ courses: [courseB, courseC] });
      await save(firstStudent);
      const replaced = row(await cursorResult(ManyStudent, { $include: ['courses'], $one: true, id: firstStudent.id }));
      assert.deepStrictEqual(
        rows(replaced.courses)
          .map((value) => value.title)
          .sort(),
        ['course-b', 'course-c']
      );

      await patchRemoveRelated(firstStudent, 'courses', courseB);
      const detached = row(await cursorResult(ManyStudent, { $include: ['courses'], $one: true, id: firstStudent.id }));
      assert.deepStrictEqual(
        rows(detached.courses).map((value) => value.title),
        ['course-c']
      );
      await patchAdd(firstStudent, 'courses', courseA);

      const secondStudent = new ManyStudent({ courses: [courseB, courseC], name: 'second-student' });
      await save(secondStudent);
      assert.strictEqual(await callbackResult((callback) => callStatic(links, 'count', [callback])), 4);

      await destroyModel(firstStudent);
      assert.strictEqual(await callbackResult((callback) => callStatic(links, 'count', [callback])), 2);
      assert.strictEqual(await callbackResult((callback) => callStatic(ManyCourse, 'count', [callback])), 3);
      const preserved = row(await cursorResult(ManyStudent, { $include: ['courses'], $one: true, id: secondStudent.id }));
      assert.deepStrictEqual(
        rows(preserved.courses)
          .map((value) => value.title)
          .sort(),
        ['course-b', 'course-c']
      );
      const unrelated = row(await cursorResult(ManyCourse, { $include: ['students'], $one: true, id: courseA.id }));
      assert.deepStrictEqual(rows(unrelated.students), []);
      assert.deepStrictEqual(
        rows(await cursorResult(ManyStudent, { 'courses.title': 'course-c' })).map((value) => value.id),
        [secondStudent.id]
      );

      const linkSchema: unknown = Reflect.get(linkDatabase, 'schema');
      if (typeof linkSchema !== 'object' || linkSchema === null) throw new Error('Many-to-many join schema control was not returned');
      const dropTableIfExists: unknown = Reflect.get(linkSchema, 'dropTableIfExists');
      if (typeof dropTableIfExists !== 'function') throw new Error('Many-to-many join schema cannot drop its table');
      await Reflect.apply(dropTableIfExists, linkSchema, []);
      let predicateDatabaseErrorCalls = 0;
      const predicateDatabaseError = await new Promise<Error>((resolve, reject) => {
        const cursor = callStatic(ManyStudent, 'cursor', [{ 'courses.title': 'course-c' }]);
        if (typeof cursor !== 'object' || cursor === null) throw new Error('Missing-pivot predicate cursor was not returned');
        const returned = callMethod(cursor, 'toJSON', [
          function joinPredicateDatabaseErrorCallback(error: Error | null, value?: unknown) {
            predicateDatabaseErrorCalls += 1;
            if (!error) reject(new Error(`Missing pivot table returned rows: ${JSON.stringify(value)}`));
            else resolve(error);
          },
        ]);
        assert.strictEqual(returned, undefined);
      });
      await Promise.resolve();
      assert.strictEqual(predicateDatabaseErrorCalls, 1);
      assert.strictEqual(Reflect.get(predicateDatabaseError, 'code'), 'SQLITE_ERROR');

      let databaseErrorCalls = 0;
      const databaseError = await new Promise<Error>((resolve, reject) => {
        callMethod(secondStudent, 'patchAdd', [
          'courses',
          courseA,
          function joinDatabaseErrorCallback(error: Error | null) {
            databaseErrorCalls += 1;
            if (!error) reject(new Error('Missing join table unexpectedly accepted a link'));
            else resolve(error);
          },
        ]);
      });
      await Promise.resolve();
      assert.strictEqual(databaseErrorCalls, 1);
      assert.strictEqual(Reflect.get(databaseError, 'code'), 'SQLITE_ERROR');
    } finally {
      try {
        await closeModels(ManyStudent, ManyCourse);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('filters both many-to-many directions through custom physical pivot keys', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    BackboneSQL.configure({ model_cache: { enabled: false } });
    CustomManyStudent.prototype.sync = BackboneSQL.sync(CustomManyStudent, { filename });
    try {
      await callbackCompletion((callback) => callStatic(CustomManyStudent, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(CustomManyCourse, 'resetSchema', [{}, callback]));

      const subjectRelation = callStatic(CustomManyStudent, 'relation', ['subjects']);
      const learnerRelation = callStatic(CustomManyCourse, 'relation', ['learners']);
      if (typeof subjectRelation !== 'object' || subjectRelation === null) throw new Error('Missing custom subjects relation');
      if (typeof learnerRelation !== 'object' || learnerRelation === null) throw new Error('Missing custom learners relation');
      assert.strictEqual(Reflect.get(subjectRelation, 'foreign_key'), 'student_relation_alias');
      assert.strictEqual(Reflect.get(subjectRelation, 'join_key'), 'pivot_student_id');
      assert.strictEqual(Reflect.get(learnerRelation, 'foreign_key'), 'course_relation_alias');
      assert.strictEqual(Reflect.get(learnerRelation, 'join_key'), 'pivot_course_id');

      const links = joinTable(CustomManyStudent, 'subjects');
      const linkDatabase = callStatic(links, 'db', []);
      if (typeof linkDatabase !== 'object' || linkDatabase === null) throw new Error('Custom many-to-many join database control was not returned');
      const linkSchema: unknown = Reflect.get(linkDatabase, 'schema');
      if (typeof linkSchema !== 'object' || linkSchema === null) throw new Error('Custom many-to-many join schema control was not returned');
      const hasColumn: unknown = Reflect.get(linkSchema, 'hasColumn');
      if (typeof hasColumn !== 'function') throw new Error('Custom many-to-many join schema cannot inspect columns');
      assert.strictEqual(await callbackResult((callback) => Reflect.apply(hasColumn, linkSchema, ['pivot_student_id', callback])), true);
      assert.strictEqual(await callbackResult((callback) => Reflect.apply(hasColumn, linkSchema, ['pivot_course_id', callback])), true);
      assert.strictEqual(await callbackResult((callback) => Reflect.apply(hasColumn, linkSchema, ['student_relation_alias', callback])), false);
      assert.strictEqual(await callbackResult((callback) => Reflect.apply(hasColumn, linkSchema, ['course_relation_alias', callback])), false);

      const quotedTitle = "quoted' OR 1=1 --";
      const algebra = new CustomManyCourse({ level: 1, title: quotedTitle, topic: 'math' });
      const geometry = new CustomManyCourse({ level: 2, title: 'geometry', topic: 'math' });
      const history = new CustomManyCourse({ level: 2, title: 'history', topic: 'humanities' });
      for (const course of [algebra, geometry, history]) await save(course);

      const first = new CustomManyStudent({ name: 'first', subjects: [algebra, geometry] });
      const second = new CustomManyStudent({ name: 'second', subjects: [geometry, history] });
      const split = new CustomManyStudent({ name: 'split', subjects: [algebra, history] });
      for (const student of [first, second, split]) await save(student);

      const mathStudents = rows(await cursorResult(CustomManyStudent, { $sort: 'name', 'subjects.topic': 'math' }));
      assert.deepStrictEqual(
        mathStudents.map((value) => value.name),
        ['first', 'second', 'split']
      );
      assert.strictEqual(await callbackResult((callback) => callStatic(CustomManyStudent, 'count', [{ 'subjects.topic': 'math' }, callback])), 3);
      assert.strictEqual(await callbackResult((callback) => callStatic(CustomManyStudent, 'exists', [{ 'subjects.title': quotedTitle }, callback])), true);

      const page = row(await cursorResult(CustomManyStudent, { $limit: 2, $page: true, $sort: 'name', 'subjects.topic': 'math' }));
      assert.strictEqual(page.offset, 0);
      assert.strictEqual(page.total_rows, 3);
      assert.deepStrictEqual(
        rows(page.rows).map((value) => value.name),
        ['first', 'second']
      );

      const sameSubject = rows(await cursorResult(CustomManyStudent, { $sort: 'name', 'subjects.level': 2, 'subjects.topic': 'math' }));
      assert.deepStrictEqual(
        sameSubject.map((value) => value.name),
        ['first', 'second']
      );
      const combined = rows(await cursorResult(CustomManyStudent, { name: 'first', 'subjects.title': quotedTitle }));
      assert.deepStrictEqual(
        combined.map((value) => value.id),
        [first.id]
      );

      const included = rows(await cursorResult(CustomManyStudent, { $include: ['subjects'], $sort: 'name', 'subjects.topic': 'math' }));
      assert.deepStrictEqual(
        included.map((value) => ({
          name: value.name,
          subjects: rows(value.subjects)
            .map((subject) => subject.title)
            .sort(),
        })),
        [
          { name: 'first', subjects: [quotedTitle, 'geometry'].sort() },
          { name: 'second', subjects: ['geometry', 'history'] },
          { name: 'split', subjects: [quotedTitle, 'history'].sort() },
        ]
      );

      const reverse = rows(await cursorResult(CustomManyCourse, { $sort: 'title', 'learners.name': 'first' }));
      assert.deepStrictEqual(
        reverse.map((value) => value.title),
        [quotedTitle, 'geometry'].sort()
      );
      assert.deepStrictEqual(rows(await cursorResult(CustomManyStudent, { 'subjects.title': { $in: [] } })), []);
      const emptyOr = rows(
        await cursorResult(CustomManyStudent, {
          $or: [{ 'subjects.title': { $in: [] } }, { 'subjects.title': quotedTitle }],
          $sort: 'name',
        })
      );
      assert.deepStrictEqual(
        emptyOr.map((value) => value.id),
        [first.id, split.id]
      );
      await assert.rejects(cursorResult(CustomManyStudent, { 'subjects.learners.name': 'first' }), /SQLite relation query supports one hop/);

      const linkPrototype: unknown = Reflect.get(links, 'prototype');
      if (typeof linkPrototype !== 'object' || linkPrototype === null) throw new Error('Custom pivot model prototype was not returned');
      const registeredLinkSync: unknown = Reflect.get(linkPrototype, 'sync');
      if (typeof registeredLinkSync !== 'function') throw new Error('Custom pivot model sync was not returned');
      let replacedLinkSyncCallbackCalls = 0;
      const replacedLinkSyncError = await (async () => {
        try {
          Reflect.set(linkPrototype, 'sync', BackboneSQL.Backbone.sync);
          return await new Promise<Error>((resolve, reject) => {
            const cursor = callStatic(CustomManyStudent, 'cursor', [{ 'subjects.topic': 'math' }]);
            if (typeof cursor !== 'object' || cursor === null) throw new Error('Replaced-pivot-sync predicate cursor was not returned');
            const returned = callMethod(cursor, 'toJSON', [
              function replacedLinkSyncPredicateCallback(error: Error | null, value?: unknown) {
                replacedLinkSyncCallbackCalls += 1;
                if (!error) reject(new Error(`Replaced pivot sync returned rows: ${JSON.stringify(value)}`));
                else resolve(error);
              },
            ]);
            assert.strictEqual(returned, undefined);
          });
        } finally {
          Reflect.set(linkPrototype, 'sync', registeredLinkSync);
        }
      })();
      await Promise.resolve();
      assert.strictEqual(replacedLinkSyncCallbackCalls, 1);
      assert.match(replacedLinkSyncError.message, /SQLite related model is no longer configured by this adapter/);

      const registeredCourseSync = CustomManyCourse.prototype.sync;
      let replacedSyncCallbackCalls = 0;
      const replacedSyncError = await (async () => {
        try {
          CustomManyCourse.prototype.sync = BackboneSQL.Backbone.sync;
          return await new Promise<Error>((resolve, reject) => {
            const cursor = callStatic(CustomManyStudent, 'cursor', [{ 'subjects.topic': 'math' }]);
            if (typeof cursor !== 'object' || cursor === null) throw new Error('Replaced-sync predicate cursor was not returned');
            const returned = callMethod(cursor, 'toJSON', [
              function replacedSyncPredicateCallback(error: Error | null, value?: unknown) {
                replacedSyncCallbackCalls += 1;
                if (!error) reject(new Error(`Replaced related sync returned rows: ${JSON.stringify(value)}`));
                else resolve(error);
              },
            ]);
            assert.strictEqual(returned, undefined);
          });
        } finally {
          CustomManyCourse.prototype.sync = registeredCourseSync;
        }
      })();
      await Promise.resolve();
      assert.strictEqual(replacedSyncCallbackCalls, 1);
      assert.match(replacedSyncError.message, /SQLite related model is no longer configured by this adapter/);
    } finally {
      try {
        await closeModels(CustomManyStudent, CustomManyCourse);
      } finally {
        safeRmSync(root);
      }
    }
  });

  it('reuses cached many-to-many identities from both include directions', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const filename = path.join(root, 'database.sqlite3');
    mkdirSync(root, { recursive: true });

    BackboneSQL.configure({ model_cache: { enabled: true, max: 100 } });
    CachedManyStudent.prototype.sync = BackboneSQL.sync(CachedManyStudent, { filename });
    try {
      await callbackCompletion((callback) => callStatic(CachedManyStudent, 'resetSchema', [{}, callback]));
      await callbackCompletion((callback) => callStatic(CachedManyCourse, 'resetSchema', [{}, callback]));

      const course = new CachedManyCourse({ title: 'cached-course' });
      await save(course);
      const student = new CachedManyStudent({ courses: [course], name: 'cached-student' });
      await save(student);

      const foundStudent = await callbackResult((callback) => callStatic(CachedManyStudent, 'findOne', [{ id: student.id }, callback]));
      assert.strictEqual(foundStudent, student);
      const includedStudent = await cursorResult(CachedManyStudent, { $include: ['courses'], $one: true, id: student.id }, 'toModels');
      assert.strictEqual(includedStudent, student);
      const studentCourses = models(await related(student, 'courses'));
      assert.strictEqual(studentCourses.length, 1);
      assert.strictEqual(studentCourses[0], course);

      const includedCourse = await cursorResult(CachedManyCourse, { $include: ['students'], $one: true, id: course.id }, 'toModels');
      assert.strictEqual(includedCourse, course);
      const courseStudents = models(await related(course, 'students'));
      assert.strictEqual(courseStudents.length, 1);
      assert.strictEqual(courseStudents[0], student);
    } finally {
      try {
        await closeModels(CachedManyStudent, CachedManyCourse);
      } finally {
        BackboneSQL.configure({ model_cache: { enabled: false } });
        safeRmSync(root);
      }
    }
  });

  it('rejects cross-database many-to-many configuration before link queries', async () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-relation-tests', randomUUID());
    const studentFilename = path.join(root, 'students.sqlite3');
    const courseFilename = path.join(root, 'courses.sqlite3');
    let courseURL = 'sqlite3://many_student_file/cross_many_courses';
    mkdirSync(root, { recursive: true });

    class CrossManyStudent extends BackboneSQL.Backbone.Model {
      urlRoot = 'sqlite3://many_student_file/cross_many_students';

      schema(): Record<string, unknown> {
        return { courses: () => ['hasMany', CrossManyCourse, { as: 'students' }], name: ['String', { nullable: false }] };
      }
    }

    class CrossManyCourse extends BackboneSQL.Backbone.Model {
      urlRoot = courseURL;

      schema(): Record<string, unknown> {
        return { students: () => ['hasMany', CrossManyStudent, { as: 'courses' }], title: ['String', { nullable: false }] };
      }
    }
    const courseSchema = CrossManyCourse.prototype.schema;
    BackboneSQL.configure({ model_cache: { enabled: false } });
    CrossManyStudent.prototype.sync = BackboneSQL.sync(CrossManyStudent, { filename: studentFilename });
    try {
      await callbackCompletion((callback) => callStatic(CrossManyStudent, 'resetSchema', [{}, callback]));
      courseURL = 'sqlite3://many_course_file/cross_many_courses';
      CrossManyCourse.prototype.schema = courseSchema;
      assert.throws(() => BackboneSQL.sync(CrossManyCourse, { filename: courseFilename }), /SQLite cross-database relations are not implemented/);
    } finally {
      try {
        await closeModels(CrossManyStudent, CrossManyCourse);
      } finally {
        safeRmSync(root);
      }
    }
  });
});

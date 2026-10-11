// Real loopback PostgreSQL. The local SQL trial requires its reviewed private runtime in TEST_POSTGRES_RUNTIME.
import { createRequire } from 'node:module';
import assert from 'assert';
import BackboneORM from 'backbone-orm';
import BackboneSQL from 'backbone-sql';
import { withPostgres } from '../lib/postgres.ts';

const nativeRequire = createRequire(import.meta.url);
type PublicFormat = 'cjs' | 'esm';

function publicEntry(format: PublicFormat): unknown {
  // createRequire forces the native require condition; the static import uses the import condition.
  const sql: unknown = format === 'cjs' ? nativeRequire('backbone-sql') : BackboneSQL;
  assert.ok(typeof sql === 'object' && sql !== null);
  assert.strictEqual(nativeRequire('backbone-orm'), BackboneORM);
  assert.strictEqual(nativeRequire('backbone'), BackboneORM.Backbone);
  assert.strictEqual(Reflect.get(sql, 'Backbone'), BackboneORM.Backbone);
  assert.strictEqual(Reflect.get(sql, '_'), BackboneORM._);
  assert.strictEqual(Reflect.get(sql, 'configure'), BackboneORM.configure);
  const modules: unknown = Reflect.get(sql, 'modules');
  assert.ok(typeof modules === 'object' && modules !== null);
  assert.strictEqual(Reflect.get(modules, 'backbone-orm'), BackboneORM);
  return sql;
}

interface ItemAttributes extends Backbone.ObjectHash {
  id?: number;
  name?: string;
  score?: number;
  group_id?: number;
  active?: boolean | null;
  created_at?: Date | null;
  json_data?: object | null;
}

function control(host: object, method: string, ...args: unknown[]): unknown {
  const sync: unknown = Reflect.get(Reflect.get(host, 'prototype'), 'sync');
  if (typeof sync !== 'function') throw new Error('Missing public SQL sync');
  return Reflect.apply(sync, host, [method, ...args]);
}

function call(host: unknown, method: string, ...args: unknown[]): unknown {
  if ((typeof host !== 'object' && typeof host !== 'function') || host === null) throw new Error('Missing public database control');
  const operation: unknown = Reflect.get(host, method);
  if (typeof operation !== 'function') throw new Error(`Missing public method: ${method}`);
  return Reflect.apply(operation, host, args);
}

function completion(invoke: (done: (error?: unknown) => void) => unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    let calls = 0;
    const returned = invoke((error) => {
      calls += 1;
      assert.strictEqual(calls, 1);
      if (error) reject(error);
      else resolve();
    });
    assert.strictEqual(returned, undefined);
  });
}

function json(type: object, query: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cursor = control(type, 'cursor', query);
    const returned = call(cursor, 'toJSON', (error: unknown, value: unknown) => (error ? reject(error) : resolve(value)));
    assert.strictEqual(returned, undefined);
  });
}

function aggregate(errors: unknown[]): Error {
  const aggregateConstructor: unknown = Reflect.get(globalThis, 'AggregateError');
  if (typeof aggregateConstructor !== 'function') throw new Error('The PostgreSQL trial requires native AggregateError');
  const error: unknown = Reflect.construct(aggregateConstructor, [errors, 'PostgreSQL public fixture and cleanup failed']);
  if (!(error instanceof Error)) throw new Error('Native AggregateError did not return an Error');
  return error;
}

async function exercise(format: PublicFormat, cache: boolean, body: (fixture: Awaited<ReturnType<typeof startFixture>>) => Promise<void>): Promise<void> {
  const runtime = process.env.TEST_POSTGRES_RUNTIME;
  if (!runtime) throw new Error('Local SQL PostgreSQL trial requires approved TEST_POSTGRES_RUNTIME; no global service fallback');
  await withPostgres(runtime, async (server) => {
    const initial = new Map<string, unknown>();
    BackboneORM.ConnectionPool.forEach((value, key) => {
      if (typeof key === 'string') initial.set(key, value);
    });
    const acquired = new Map<string, unknown>();
    const released = new Set<unknown>();
    const releaseConnection = (connection: unknown): void => {
      assert.ok([...acquired.values()].includes(connection));
      released.add(connection);
    };
    const captureAdmission = (): void => {
      BackboneORM.ConnectionPool.forEach((connection, key) => {
        if (typeof key === 'string' && !initial.has(key) && !acquired.has(key) && key.startsWith(`postgres://127.0.0.1:${server.connection.port}/`)) acquired.set(key, connection);
      });
    };
    let cacheConfigured = false;
    let failure: { value: unknown } | undefined;
    try {
      cacheConfigured = true;
      BackboneORM.model_cache.configure({ enabled: cache, max: 100 });
      const fixture = startFixture(server, captureAdmission, format, releaseConnection);
      await body(fixture);
    } catch (value) {
      failure = { value };
    }
    const errors: unknown[] = failure ? [failure.value] : [];
    for (const [key, connection] of acquired) {
      try {
        if (released.has(connection) && BackboneORM.ConnectionPool.get(key) === undefined) continue;
        if (BackboneORM.ConnectionPool.get(key) !== connection) throw new Error('SQL pool entry was replaced; replacement not disposed');
        await BackboneORM.ConnectionPool.dispose(key);
      } catch (error) {
        errors.push(error);
      }
    }
    if (cacheConfigured) {
      try {
        BackboneORM.model_cache.configure({ enabled: false });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw aggregate(errors);
  });
}

function startFixture(server: Parameters<Parameters<typeof withPostgres>[1]>[0], admitted: () => void, format: PublicFormat, releaseConnection: (connection: unknown) => void) {
  const sql = publicEntry(format);
  class Item extends BackboneSQL.Backbone.Model<ItemAttributes> {
    urlRoot = server.modelURL('pg_items');
  }
  Reflect.set(Item.prototype, 'schema', {
    name: ['String', { nullable: false, unique: true }],
    score: 'Integer',
    group_id: 'Integer',
    active: 'Boolean',
    created_at: 'DateTime',
    json_data: 'JSON',
  });
  try {
    call(sql, 'sync', Item);
  } finally {
    admitted();
  }
  return { Item, server, db: control(Item, 'db'), sql, admitted, releaseConnection };
}

function records(value: unknown): Array<Record<string, unknown>> {
  assert.ok(Array.isArray(value));
  return value.map((row: unknown) => {
    assert.ok(typeof row === 'object' && row !== null);
    return { ...row };
  });
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return { ...value };
}

function relationID(model: Backbone.Model): number {
  const value: unknown = model.id;
  assert.ok(typeof value === 'number');
  return value;
}

function relationResult(invoke: (callback: (error: unknown, value?: unknown) => void) => unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let calls = 0;
    invoke((error, value) => {
      calls += 1;
      assert.strictEqual(calls, 1);
      if (error) reject(error);
      else resolve(value);
    });
  });
}

async function saveRelations(model: Backbone.Model): Promise<void> {
  await relationResult((done) => model.save(null, { success: () => done(null), error: (_model, error) => done(error) }));
}

async function destroyRelations(model: Backbone.Model): Promise<void> {
  await relationResult((done) => model.destroy({ success: () => done(null), error: (_model, error) => done(error) }));
}

function relationGraph(fixture: Awaited<ReturnType<typeof startFixture>>, suffix = '', explicitReverse = false) {
  const { sql, server, admitted } = fixture;
  class Child extends BackboneSQL.Backbone.Model {
    urlRoot = server.modelURL(`pg_children${suffix}`);
    schema(): object {
      return { name: 'String', active: 'Boolean', happened: 'DateTime', ...(explicitReverse ? { parent: () => ['belongsTo', Parent, { as: 'children' }] } : {}) };
    }
  }
  class Parent extends BackboneSQL.Backbone.Model {
    urlRoot = server.modelURL(`pg_parents${suffix}`);
    schema(): object {
      return { name: 'String', score: 'Integer', primary: () => ['belongsTo', Child], children: () => ['hasMany', Child, ...(explicitReverse ? [{ as: 'parent' }] : [])] };
    }
  }
  const configure = (type: typeof Child | typeof Parent, entry: unknown = sql): void => {
    try {
      call(entry, 'sync', type);
    } finally {
      admitted();
    }
  };
  const foreignKey = (): string => {
    const relation = record(call(Parent, 'relation', 'children'));
    const reverse = record(relation.reverse_relation);
    assert.ok(typeof reverse.foreign_key === 'string');
    return reverse.foreign_key;
  };
  return { Child, Parent, configure, foreignKey };
}

function hasOneGraph(fixture: Awaited<ReturnType<typeof startFixture>>) {
  class Profile extends BackboneSQL.Backbone.Model {
    urlRoot = fixture.server.modelURL('pg_has_one_profiles');
    schema(): object {
      return { title: 'String', active: 'Boolean' };
    }
  }
  class Owner extends BackboneSQL.Backbone.Model {
    urlRoot = fixture.server.modelURL('pg_has_one_owners');
    schema(): object {
      return { name: 'String', profile: () => ['hasOne', Profile] };
    }
  }
  const configure = (type: typeof Profile | typeof Owner): void => {
    try {
      call(fixture.sql, 'sync', type);
    } finally {
      fixture.admitted();
    }
  };
  const reverse = (): { key: string; foreignKey: string } => {
    const relation = record(record(call(Owner, 'relation', 'profile')).reverse_relation);
    assert.strictEqual(relation.type, 'belongsTo');
    assert.ok(typeof relation.key === 'string');
    assert.ok(typeof relation.foreign_key === 'string');
    return { key: relation.key, foreignKey: relation.foreign_key };
  };
  return { Profile, Owner, configure, reverse };
}

function pivotGraph(fixture: Awaited<ReturnType<typeof startFixture>>, customKeys: boolean) {
  class Course extends BackboneSQL.Backbone.Model {
    urlRoot = fixture.server.modelURL('pg_pivot_courses');
    schema(): object {
      return {
        title: 'String',
        active: 'Boolean',
        level: 'Integer',
        students: () => ['hasMany', Student, { as: 'courses', ...(customKeys ? { foreign_key: 'course_relation_alias', join_key: 'pivot_course_id' } : {}) }],
      };
    }
  }
  class Student extends BackboneSQL.Backbone.Model {
    urlRoot = fixture.server.modelURL('pg_pivot_students');
    schema(): object {
      return {
        name: 'String',
        courses: () => ['hasMany', Course, { as: 'students', ...(customKeys ? { foreign_key: 'student_relation_alias', join_key: 'pivot_student_id' } : {}) }],
      };
    }
  }
  const configure = (type: typeof Student | typeof Course): void => {
    try {
      call(fixture.sql, 'sync', type);
    } finally {
      fixture.admitted();
    }
  };
  const pivot = () => {
    const relation = call(Student, 'relation', 'courses');
    assert.ok(typeof relation === 'object' && relation !== null);
    const reverse = Reflect.get(relation, 'reverse_relation');
    assert.ok(typeof reverse === 'object' && reverse !== null);
    const type: unknown = Reflect.get(relation, 'join_table');
    assert.ok(typeof type === 'function');
    assert.strictEqual(Reflect.get(reverse, 'join_table'), type);
    const studentKey: unknown = Reflect.get(relation, 'join_key');
    const courseKey: unknown = Reflect.get(reverse, 'join_key');
    const table: unknown = control(type, 'tableName');
    assert.ok(typeof studentKey === 'string' && typeof courseKey === 'string' && typeof table === 'string');
    return { type, relation, reverse, studentKey, courseKey, table, db: control(type, 'db') };
  };
  return { Student, Course, configure, pivot };
}

describe('PostgreSQL public package pivots', () => {
  for (const format of ['cjs', 'esm'] as const) {
    for (const cache of [false, true]) {
      for (const order of ['student-first', 'course-first'] as const) {
        it(`persists and includes PG pivots ${order} through native ${format} with cache=${cache}`, async () => {
          await exercise(format, cache, async (fixture) => {
            const { Student, Course, configure, pivot } = pivotGraph(fixture, true);
            configure(order === 'student-first' ? Student : Course);
            const links = pivot();
            assert.strictEqual(links.studentKey, 'pivot_student_id');
            assert.strictEqual(links.courseKey, 'pivot_course_id');
            assert.strictEqual(Reflect.get(links.relation, 'foreign_key'), 'student_relation_alias');
            assert.strictEqual(Reflect.get(links.reverse, 'foreign_key'), 'course_relation_alias');
            const studentDB = control(Student, 'db');
            const courseDB = control(Course, 'db');
            const connection = record(studentDB).connection;
            assert.ok(record(courseDB).connection === connection, 'Pivot endpoints must share the exact owned connection');
            assert.ok(record(links.db).connection === connection, 'Pivot must share the exact owned connection');
            await completion((done) => call(studentDB, 'ensureSchema', done));
            assert.strictEqual(await fixture.server.database.schema.hasTable(links.table), true);
            assert.strictEqual(await fixture.server.database.schema.hasTable('pg_pivot_courses'), false, 'ensure visits pivots, not ordinary endpoint tables');
            await completion((done) => call(courseDB, 'ensureSchema', done));
            const columns = await fixture.server.database('information_schema.columns').where({ table_schema: 'public', table_name: links.table }).select('column_name', 'data_type', 'is_nullable');
            for (const key of [links.studentKey, links.courseKey]) {
              assert.ok(columns.some((column) => column.column_name === key && column.data_type === 'integer' && column.is_nullable === 'YES'));
            }
            assert.ok(!columns.some((column) => column.column_name === 'student_relation_alias' || column.column_name === 'course_relation_alias'));
            const indexes = await fixture.server.database.raw('select indexdef from pg_indexes where tablename = ?', [links.table]);
            for (const key of [links.studentKey, links.courseKey]) assert.ok(records(indexes.rows).some((row) => typeof row.indexdef === 'string' && row.indexdef.includes(key)));
            const constraints = await fixture.server.database.raw("select contype from pg_constraint where conrelid = ?::regclass and contype = 'f'", [links.table]);
            assert.deepStrictEqual(constraints.rows, [], 'this slice does not create REFERENCES constraints');

            const quoted = "quoted' OR 1=1 --";
            const a = new Course({ title: quoted, active: true, level: 1 });
            const b = new Course({ title: 'geometry', active: false, level: 2 });
            const c = new Course({ title: 'history', active: null, level: 2 });
            for (const course of [a, b, c]) await saveRelations(course);
            const first = new Student({ name: 'first', courses: [a, b] });
            const other = new Student({ name: 'other', courses: [b, c] });
            const empty = new Student({ name: 'empty', courses: [] });
            for (const student of [first, other, empty]) await saveRelations(student);
            const nativePairs = async () => fixture.server.database(links.table).select(links.studentKey, links.courseKey).orderBy(links.studentKey).orderBy(links.courseKey);
            assert.deepStrictEqual(await nativePairs(), [
              { [links.studentKey]: first.id, [links.courseKey]: a.id },
              { [links.studentKey]: first.id, [links.courseKey]: b.id },
              { [links.studentKey]: other.id, [links.courseKey]: b.id },
              { [links.studentKey]: other.id, [links.courseKey]: c.id },
            ]);
            assert.deepStrictEqual(
              records(record(await json(Student, { id: first.id, $one: true, $include: 'courses' })).courses)
                .map((row) => row.id)
                .sort(),
              [a.id, b.id].sort()
            );
            assert.deepStrictEqual(
              records(record(await json(Course, { id: b.id, $one: true, $include: 'students' })).students)
                .map((row) => row.id)
                .sort(),
              [first.id, other.id].sort()
            );
            assert.deepStrictEqual(record(await json(Student, { id: empty.id, $one: true, $include: 'courses' })).courses, []);
            assert.strictEqual(await json(Student, { id: -1, $one: true, $include: 'courses' }), null);
            assert.deepStrictEqual(await json(Student, { id: -1, $include: 'courses' }), []);
            const projected = record(await json(Student, { id: first.id, $one: true, $select: ['name'], $include: 'courses' }));
            assert.deepStrictEqual(Object.keys(projected).sort(), ['courses', 'name']);
            assert.strictEqual(records(projected.courses).length, 2);
            const reverseProjected = record(await json(Course, { id: b.id, $one: true, $select: ['title'], $include: 'students' }));
            assert.deepStrictEqual(Object.keys(reverseProjected).sort(), ['students', 'title']);
            assert.strictEqual(records(reverseProjected.students).length, 2);
            assert.deepStrictEqual(await json(Student, { id: first.id, $values: 'name', $include: 'courses' }), ['first']);
            const found = await relationResult((done) => call(Student, 'findOne', { id: first.id, $include: 'courses' }, done));
            assert.ok(found instanceof Student);
            if (cache) assert.ok(found === first, 'Cached pivot find must return the saved model');
            else assert.ok(found !== first, 'Uncached pivot find must return a distinct model');
            const fetched = new Student({ id: relationID(first) });
            await fetched.fetch();
            const related = await relationResult((done) => call(fetched, 'get', 'courses', done));
            assert.ok(Array.isArray(related) && related.every((model: unknown) => model instanceof Course));
            assert.deepStrictEqual(related.map((model: Backbone.Model) => model.id).sort(), [a.id, b.id].sort());
            if (cache) assert.ok(related.includes(a) && related.includes(b));
            const reverseFound = await relationResult((done) => call(Course, 'findOne', { id: b.id, $include: 'students' }, done));
            assert.ok(reverseFound instanceof Course);
            if (cache) assert.ok(reverseFound === b, 'Cached reverse pivot find must return the saved model');

            await assert.rejects(
              relationResult((done) => call(first, 'patchAdd', 'courses', a, done)),
              /Join already exists/
            );
            assert.strictEqual((await nativePairs()).length, 4);
            await fixture.server.database(links.table).insert({ [links.studentKey]: first.id, [links.courseKey]: a.id });
            assert.strictEqual((await nativePairs()).length, 5, 'native duplicate links remain permitted');
            assert.strictEqual(records(record(await json(Student, { id: first.id, $one: true, $include: 'courses' })).courses).length, 2);
            assert.strictEqual(await json(Student, { 'courses.level': { $in: [1, 2] }, $count: true }), 2);
            assert.strictEqual(await json(Student, { 'courses.title': quoted, $exists: true }), true);
            assert.strictEqual(await json(Student, { name: 'first', 'courses.title': quoted, $count: true }), 1);
            assert.strictEqual(records(record(await json(Student, { 'courses.title': quoted, $one: true, $include: 'courses' })).courses).length, 2, 'filtering one course must not truncate the include');
            assert.strictEqual(await json(Student, { 'courses.title': quoted, 'courses.level': 2, $exists: true }), false, 'predicates for one relation must match the same course');
            assert.strictEqual(await json(Course, { 'students.name': 'first', $count: true }), 2);
            assert.strictEqual(await json(Student, { 'courses.title': { $in: [] }, $count: true }), 0);
            assert.strictEqual(await json(Student, { $or: [{ 'courses.title': { $in: [] } }, { name: 'empty' }], $count: true }), 1);
            const page = record(await json(Student, { 'courses.level': { $in: [1, 2] }, $sort: ['name', 'id'], $page: true, $offset: 1, $limit: 1, $select: ['name'], $include: 'courses' }));
            assert.strictEqual(page.total_rows, 2);
            assert.strictEqual(page.offset, 1);
            const pageRow = records(page.rows)[0];
            assert.deepStrictEqual(Object.keys(pageRow).sort(), ['courses', 'name']);
            assert.strictEqual(pageRow.name, 'other');
            assert.deepStrictEqual(
              records(pageRow.courses)
                .map((row) => row.id)
                .sort(),
              [b.id, c.id].sort(),
              'includes are complete, not restricted to the matching course'
            );

            first.set('courses', [b, c]);
            await saveRelations(first);
            assert.deepStrictEqual(
              (await nativePairs()).filter((row) => row[links.studentKey] === first.id).map((row) => row[links.courseKey]),
              [b.id, c.id]
            );
            await relationResult((done) => call(first, 'patchRemove', 'courses', b, done));
            await relationResult((done) => call(first, 'patchAdd', 'courses', a, done));
            assert.deepStrictEqual(
              records(record(await json(Student, { id: first.id, $one: true, $include: 'courses' })).courses)
                .map((row) => row.id)
                .sort(),
              [a.id, c.id].sort()
            );
            first.set('courses', []);
            await saveRelations(first);
            assert.deepStrictEqual(record(await json(Student, { id: first.id, $one: true, $include: 'courses' })).courses, []);
            await relationResult((done) => call(first, 'patchAdd', 'courses', a, done));
            await destroyRelations(first);
            assert.deepStrictEqual(
              (await nativePairs()).map((row) => row[links.studentKey]),
              [other.id, other.id]
            );
            assert.strictEqual((await fixture.server.database('pg_pivot_courses').select()).length, 3);
            await destroyRelations(b);
            assert.deepStrictEqual(await nativePairs(), [{ [links.studentKey]: other.id, [links.courseKey]: c.id }]);
            assert.strictEqual((await fixture.server.database('pg_pivot_students').where({ id: other.id }).first()).name, 'other');
            assert.strictEqual((await fixture.server.database('pg_pivot_courses').where({ id: a.id }).first()).title, quoted);
            assert.deepStrictEqual(record(await json(Student, { id: empty.id, $one: true, $include: 'courses' })).courses, []);
            const closing = control(Student, 'closeConnection');
            assert.ok(closing instanceof Promise);
            await Promise.all([closing, completion((done) => control(Course, 'closeConnection', done))]);
            fixture.releaseConnection(connection);
            await assert.rejects(json(Student, { $include: 'courses' }), /PostgreSQL connection is closed/);
          });
        });
      }

      it(`checks PG pivot schema, ownership and partial cleanup errors through native ${format} with cache=${cache}`, async () => {
        await exercise(format, cache, async (fixture) => {
          const { Student, Course, configure, pivot } = pivotGraph(fixture, false);
          configure(Student);
          const links = pivot();
          const studentDB = control(Student, 'db');
          const courseDB = control(Course, 'db');
          const driver = call(record(studentDB).connection, 'knex');
          await completion((done) => call(studentDB, 'ensureSchema', done));
          await completion((done) => call(courseDB, 'ensureSchema', done));
          const survivor = new Course({ title: 'endpoint survivor' });
          await saveRelations(survivor);
          const ddl: string[] = [];
          const trackDDL = (query: { sql: string }): void => {
            if (!/^(drop table|create table)/i.test(query.sql)) return;
            const action = /^drop/i.test(query.sql) ? 'drop' : 'create';
            if (query.sql.includes('"pg_pivot_students"')) ddl.push(`${action}:parent`);
            if (query.sql.includes(`"${links.table}"`)) ddl.push(`${action}:pivot`);
          };
          call(driver, 'on', 'query', trackDDL);
          try {
            await completion((done) => call(studentDB, 'resetSchema', {}, done));
          } finally {
            call(driver, 'removeListener', 'query', trackDDL);
          }
          assert.deepStrictEqual(ddl, ['drop:parent', 'drop:pivot', 'create:pivot', 'create:parent']);
          assert.strictEqual((await fixture.server.database('pg_pivot_courses').where({ id: survivor.id }).first()).title, 'endpoint survivor');
          const retainedIDs = await fixture.server
            .database(links.table)
            .insert({ [links.studentKey]: 700 })
            .returning('id');
          assert.strictEqual(retainedIDs.length, 1);
          await fixture.server.database.schema.alterTable(links.table, (table) => {
            table.dropColumn(links.courseKey);
            table.string('extra');
          });
          await fixture.server.database(links.table).where({ id: retainedIDs[0].id }).update({ extra: 'preserved' });
          await completion((done) => call(studentDB, 'ensureSchema', done));
          assert.strictEqual(await fixture.server.database.schema.hasColumn(links.table, links.courseKey), true);
          const retained = await fixture.server.database(links.table).where({ id: retainedIDs[0].id }).first();
          assert.strictEqual(retained[links.studentKey], 700);
          assert.strictEqual(retained[links.courseKey], null);
          assert.strictEqual(retained.extra, 'preserved');

          const prototype: unknown = Reflect.get(links.type, 'prototype');
          assert.ok(typeof prototype === 'object' && prototype !== null);
          const registeredSync: unknown = Reflect.get(prototype, 'sync');
          assert.ok(typeof registeredSync === 'function');
          let queries = 0;
          const countQuery = (): void => {
            queries += 1;
          };
          call(driver, 'on', 'query', countQuery);
          try {
            Reflect.set(prototype, 'sync', BackboneSQL.Backbone.sync);
            for (const query of [
              { id: -1, $include: 'courses' },
              { 'courses.title': 'anything', $count: true },
            ]) {
              await assert.rejects(
                relationResult((done) => call(control(Student, 'cursor', query), 'toJSON', done)),
                /PostgreSQL related model is no longer configured/
              );
            }
            await assert.rejects(
              completion((done) => call(studentDB, 'ensureSchema', done)),
              /PostgreSQL related model is no longer configured/
            );
            await assert.rejects(saveRelations(new Student({ name: 'must not write' })), /PostgreSQL related model is no longer configured/);
            assert.strictEqual(queries, 0);
          } finally {
            Reflect.set(prototype, 'sync', registeredSync);
            call(driver, 'removeListener', 'query', countQuery);
          }
          await fixture.server.database.raw('create database ??', ['pg_foreign_pivot']);
          class ForeignPivot extends BackboneSQL.Backbone.Model {
            urlRoot = fixture.server.modelURL(links.table).replace('/postgres/', '/pg_foreign_pivot/');
            schema(): object {
              return { [links.studentKey]: 'Integer', [links.courseKey]: 'Integer' };
            }
          }
          try {
            call(fixture.sql, 'sync', ForeignPivot);
          } finally {
            fixture.admitted();
          }
          await completion((done) => call(control(ForeignPivot, 'db'), 'ensureSchema', done));
          queries = 0;
          call(driver, 'on', 'query', countQuery);
          try {
            Reflect.set(links.relation, 'join_table', ForeignPivot);
            for (const query of [
              { id: -1, $include: 'courses' },
              { 'courses.title': 'anything', $count: true },
            ]) {
              await assert.rejects(
                relationResult((done) => call(control(Student, 'cursor', query), 'toJSON', done)),
                (error: unknown) => error instanceof Error && /PostgreSQL cross-database/.test(error.message) && !error.message.includes(fixture.server.connection.password)
              );
            }
            await assert.rejects(
              completion((done) => call(studentDB, 'resetSchema', {}, done)),
              /PostgreSQL cross-database/
            );
            await assert.rejects(saveRelations(new Student({ name: 'must not write' })), /PostgreSQL cross-database/);
            assert.strictEqual(queries, 0);
          } finally {
            Reflect.set(links.relation, 'join_table', links.type);
            call(driver, 'removeListener', 'query', countQuery);
          }

          const linked = new Student({ name: 'linked', courses: [survivor] });
          const other = new Student({ name: 'unrelated', courses: [survivor] });
          await saveRelations(linked);
          await saveRelations(other);
          await fixture.server.database.raw("create function pg_pivot_cleanup_failure() returns trigger language plpgsql as $$ begin raise exception 'owned PG pivot cleanup failure'; end $$");
          await fixture.server.database.raw('create trigger pg_pivot_cleanup_failure before delete on ?? for each row execute function pg_pivot_cleanup_failure()', [links.table]);
          const driverErrors: unknown[] = [];
          const trackError = (error: unknown): void => {
            driverErrors.push(error);
          };
          call(driver, 'on', 'query-error', trackError);
          try {
            let calls = 0;
            let notified: unknown;
            const returned = linked.destroy({
              error: (_model, error) => {
                calls += 1;
                notified = error;
              },
            });
            assert.ok(returned instanceof Promise);
            await assert.rejects(returned, (error: unknown) => error === notified && error instanceof Error && 'code' in error && error.code === 'P0001');
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(calls, 1);
            assert.strictEqual(driverErrors.length, 1);
            assert.strictEqual(notified, driverErrors[0]);
          } finally {
            call(driver, 'removeListener', 'query-error', trackError);
          }
          assert.strictEqual(await fixture.server.database('pg_pivot_students').where({ id: linked.id }).first(), undefined, 'parent deletion precedes failed link cleanup');
          assert.strictEqual(
            (
              await fixture.server
                .database(links.table)
                .where({ [links.studentKey]: linked.id })
                .select()
            ).length,
            1,
            'failed cleanup has partial effects, no rollback'
          );
          assert.strictEqual(
            (
              await fixture.server
                .database(links.table)
                .where({ [links.studentKey]: other.id })
                .select()
            ).length,
            1
          );
          assert.strictEqual((await fixture.server.database('pg_pivot_courses').where({ id: survivor.id }).first()).title, 'endpoint survivor');
          await fixture.server.database.schema.dropTable(links.table);
          await assert.rejects(
            relationResult((done) => call(control(Student, 'cursor', { $include: 'courses' }), 'toJSON', done)),
            (error: unknown) => error instanceof Error && 'code' in error && error.code === '42P01'
          );
          await assert.rejects(
            relationResult((done) => call(other, 'patchAdd', 'courses', survivor, done)),
            (error: unknown) => error instanceof Error && 'code' in error && error.code === '42P01'
          );
        });
      });
    }
  }
});

describe('PostgreSQL public package hasOne', () => {
  for (const format of ['cjs', 'esm'] as const) {
    for (const cache of [false, true]) {
      for (const order of ['profile-first', 'owner-first'] as const) {
        it(`persists PG hasOne ${order} through native ${format} with cache=${cache}`, async () => {
          await exercise(format, cache, async (fixture) => {
            const { Profile, Owner, configure, reverse } = hasOneGraph(fixture);
            let preconfigured: InstanceType<typeof Profile> | undefined;
            if (order === 'profile-first') {
              configure(Profile);
              await completion((done) => call(control(Profile, 'db'), 'createOrUpdateTable', {}, done));
              preconfigured = new Profile({ title: 'preconfigured survivor', active: null });
              await saveRelations(preconfigured);
              assert.strictEqual(Owner.prototype.sync, BackboneSQL.Backbone.Model.prototype.sync);
            } else {
              assert.strictEqual(Profile.prototype.sync, BackboneSQL.Backbone.Model.prototype.sync);
            }
            configure(Owner);
            const profileDB = control(Profile, 'db');
            const ownerDB = control(Owner, 'db');
            const connection = record(ownerDB).connection;
            assert.ok(connection === record(profileDB).connection, 'hasOne uses the exact owned handle');
            await completion((done) => call(profileDB, 'createOrUpdateTable', {}, done));
            await completion((done) => call(ownerDB, 'ensureSchema', done));
            const { key, foreignKey } = reverse();
            const columns = await fixture.server.database('information_schema.columns').where({ table_schema: 'public', table_name: 'pg_has_one_profiles', column_name: foreignKey }).select('data_type', 'is_nullable');
            assert.deepStrictEqual(columns, [{ data_type: 'integer', is_nullable: 'YES' }]);
            const indexes = await fixture.server.database.raw('select indexdef from pg_indexes where tablename = ?', ['pg_has_one_profiles']);
            assert.ok(records(indexes.rows).some((row) => typeof row.indexdef === 'string' && row.indexdef.includes(foreignKey)));
            if (preconfigured) {
              const retained = await fixture.server
                .database('pg_has_one_profiles')
                .where({ id: relationID(preconfigured) })
                .first();
              assert.strictEqual(retained.title, 'preconfigured survivor');
              assert.strictEqual(retained[foreignKey], null);
            }

            const first = new Profile({ title: 'first', active: true });
            const replacement = new Profile({ title: 'replacement', active: false });
            const survivor = new Profile({ title: 'independent', active: null });
            for (const profile of [first, replacement, survivor]) await saveRelations(profile);
            const owner = new Owner({ name: 'owner', profile: first });
            const empty = new Owner({ name: 'empty', profile: null });
            const other = new Owner({ name: 'other', profile: survivor });
            for (const model of [owner, empty, other]) await saveRelations(model);
            assert.strictEqual(
              (
                await fixture.server
                  .database('pg_has_one_profiles')
                  .where({ id: relationID(first) })
                  .first()
              )[foreignKey],
              relationID(owner)
            );
            const included = record(await json(Owner, { id: owner.id, $one: true, $include: 'profile' }));
            assert.strictEqual(record(included.profile).id, first.id);
            assert.strictEqual(record(included.profile).title, 'first');
            assert.strictEqual(record(included.profile).active, true);
            assert.strictEqual(record(await json(Owner, { id: empty.id, $one: true, $include: 'profile' })).profile, null);
            assert.deepStrictEqual(await json(Owner, { id: -1, $include: 'profile' }), []);
            assert.strictEqual(await json(Owner, { id: -1, $one: true, $include: 'profile' }), null);
            assert.strictEqual(record(record(await json(Profile, { id: first.id, $one: true, $include: key }))[key]).id, owner.id);
            assert.strictEqual(record(await json(Profile, { id: replacement.id, $one: true, $include: key }))[key], null);
            const projected = record(await json(Owner, { id: owner.id, $one: true, $select: ['name'], $include: 'profile' }));
            assert.deepStrictEqual(Object.keys(projected).sort(), ['name', 'profile']);
            assert.strictEqual(record(projected.profile).title, 'first');
            const reverseProjected = record(await json(Profile, { id: first.id, $one: true, $select: ['title'], $include: key }));
            assert.deepStrictEqual(Object.keys(reverseProjected).sort(), [key, 'title'].sort());
            assert.strictEqual(record(reverseProjected[key]).name, 'owner');
            assert.deepStrictEqual(await json(Owner, { id: owner.id, $values: 'name', $include: 'profile' }), ['owner']);
            const page = record(await json(Owner, { 'profile.title': 'first', $page: true, $limit: 1, $select: ['name'], $include: 'profile' }));
            assert.strictEqual(page.total_rows, 1);
            assert.deepStrictEqual(Object.keys(records(page.rows)[0]).sort(), ['name', 'profile']);
            assert.strictEqual(await json(Owner, { 'profile.title': 'first', $count: true }), 1);
            assert.strictEqual(await json(Owner, { 'profile.title': 'absent', $exists: true }), false);
            const found: unknown = await relationResult((done) => call(Owner, 'findOne', { id: owner.id, $include: 'profile' }, done));
            assert.ok(found instanceof Owner);
            if (cache) assert.strictEqual(found, owner);
            else assert.notStrictEqual(found, owner);
            const fetched = new Owner({ id: relationID(owner) });
            await fetched.fetch();
            const fetchedProfile = await relationResult((done) => call(fetched, 'get', 'profile', done));
            assert.ok(fetchedProfile instanceof Profile);
            assert.strictEqual(fetchedProfile.id, first.id);
            if (cache) assert.strictEqual(fetchedProfile, first);

            fetched.set('profile', replacement);
            await saveRelations(fetched);
            assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: first.id }).first())[foreignKey], null);
            assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: replacement.id }).first())[foreignKey], owner.id);
            assert.strictEqual(record(record(await json(Owner, { id: owner.id, $one: true, $include: 'profile' })).profile).id, replacement.id);
            fetched.set('profile', null);
            await saveRelations(fetched);
            assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: replacement.id }).first())[foreignKey], null);
            assert.strictEqual(record(await json(Owner, { id: owner.id, $one: true, $include: 'profile' })).profile, null);
            fetched.set('profile', replacement);
            await saveRelations(fetched);
            await destroyRelations(fetched);
            assert.strictEqual(await json(Owner, { id: owner.id, $one: true }), null);
            assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: replacement.id }).first())[foreignKey], null);
            assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: survivor.id }).first())[foreignKey], other.id);
            assert.strictEqual(record(record(await json(Owner, { id: other.id, $one: true, $include: 'profile' })).profile).id, survivor.id);
            if (preconfigured) assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: preconfigured.id }).first()).title, 'preconfigured survivor');

            const duplicateOwner = new Owner({ name: 'duplicate' });
            await saveRelations(duplicateOwner);
            const duplicateIDs = await fixture.server
              .database('pg_has_one_profiles')
              .insert([
                { title: 'duplicate-a', [foreignKey]: duplicateOwner.id },
                { title: 'duplicate-b', [foreignKey]: duplicateOwner.id },
              ])
              .returning('id');
            const duplicate = record(record(await json(Owner, { id: duplicateOwner.id, $one: true, $include: 'profile' })).profile);
            assert.ok(
              duplicateIDs.some((row) => row.id === duplicate.id),
              'duplicate hasOne match remains unspecified'
            );
            assert.strictEqual(await json(Owner, { 'profile.title': { $in: ['duplicate-a', 'duplicate-b'] }, $count: true }), 1);
            assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: first.id }).first()).title, 'first');
            const closing = control(Owner, 'closeConnection');
            assert.ok(closing instanceof Promise);
            await Promise.all([closing, completion((done) => control(Profile, 'closeConnection', done))]);
            fixture.releaseConnection(connection);
            await assert.rejects(json(Owner, { $include: 'profile' }), /PostgreSQL connection is closed/);
          });
        });
      }

      for (const boundary of ['worker', 'public'] as const) {
        it(`preserves PG hasOne null-save ${boundary} failure boundary through native ${format} with cache=${cache}`, async () => {
          await exercise(format, cache, async (fixture) => {
            const { Owner, Profile, configure, reverse } = hasOneGraph(fixture);
            configure(Owner);
            const ownerDB = control(Owner, 'db');
            const profileDB = control(Profile, 'db');
            assert.strictEqual(record(ownerDB).connection, record(profileDB).connection);
            await completion((done) => call(profileDB, 'ensureSchema', done));
            await completion((done) => call(ownerDB, 'ensureSchema', done));
            const { foreignKey } = reverse();
            const workerProfile = new Profile({ title: 'worker linked' });
            const publicProfile = new Profile({ title: 'public linked' });
            const survivor = new Profile({ title: 'survivor' });
            for (const profile of [workerProfile, publicProfile, survivor]) await saveRelations(profile);
            const workerOwner = new Owner({ name: 'worker owner', profile: workerProfile });
            const publicOwner = new Owner({ name: 'before null', profile: publicProfile });
            const other = new Owner({ name: 'unrelated', profile: survivor });
            for (const owner of [workerOwner, publicOwner, other]) await saveRelations(owner);
            await fixture.server.database.raw("create function pg_has_one_null_failure() returns trigger language plpgsql as $$ begin if new.?? is null and old.?? is not null then raise exception 'owned PG hasOne null-save failure'; end if; return new; end $$", [foreignKey, foreignKey]);
            await fixture.server.database.raw('create trigger pg_has_one_null_failure before update on ?? for each row execute function pg_has_one_null_failure()', ['pg_has_one_profiles']);
            const database = call(record(profileDB).connection, 'knex');
            const driverErrors: unknown[] = [];
            const observeDriverError = (error: unknown): void => {
              driverErrors.push(error);
            };
            let listening = false;
            let failed = false;
            let failure: unknown;
            try {
              call(database, 'on', 'query-error', observeDriverError);
              listening = true;
              if (boundary === 'worker') {
                workerOwner.set('profile', null);
                const schema = control(Owner, 'schema');
                const relation = call(schema, 'relation', 'profile');
                let workerCalls = 0;
                const workerError = await relationResult((done) =>
                  call(relation, 'save', workerOwner, (error: unknown) => {
                    workerCalls += 1;
                    done(error);
                  })
                ).then(
                  () => {
                    throw new Error('Null relation worker unexpectedly succeeded');
                  },
                  (error: unknown) => error
                );
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.strictEqual(workerCalls, 1);
                assert.strictEqual(driverErrors.length, 1);
                assert.strictEqual(workerError, driverErrors[0]);
                assert.ok(workerError instanceof Error && 'code' in workerError && workerError.code === 'P0001');
                assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: workerProfile.id }).first())[foreignKey], workerOwner.id);
                assert.strictEqual(workerOwner.get('profile'), null);
                assert.strictEqual((await fixture.server.database('pg_has_one_owners').where({ id: workerOwner.id }).first()).name, 'worker owner');
                assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: survivor.id }).first())[foreignKey], other.id);
              } else {
                publicOwner.set('name', 'parent write committed');
                publicOwner.set('profile', null);
                let errorCalls = 0;
                let successCalls = 0;
                const publicError = await relationResult((done) =>
                  publicOwner.save(null, {
                    success: () => {
                      successCalls += 1;
                      done(null);
                    },
                    error: (_model, error) => {
                      errorCalls += 1;
                      done(error);
                    },
                  })
                ).then(
                  () => {
                    throw new Error('Null public save unexpectedly succeeded');
                  },
                  (error: unknown) => error
                );
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.strictEqual(errorCalls, 1);
                assert.strictEqual(successCalls, 0);
                assert.strictEqual(driverErrors.length, 1);
                assert.ok(driverErrors[0] instanceof Error && 'code' in driverErrors[0] && driverErrors[0].code === 'P0001');
                assert.ok(publicError instanceof Error);
                assert.notStrictEqual(publicError, driverErrors[0]);
                assert.match(publicError.message, /^Failed to save relations\./);
                assert.match(publicError.message, /owned PG hasOne null-save failure/);
                assert.ok(!publicError.message.includes(fixture.server.connection.password));
                assert.strictEqual((await fixture.server.database('pg_has_one_owners').where({ id: publicOwner.id }).first()).name, 'parent write committed');
                assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: publicProfile.id }).first())[foreignKey], publicOwner.id);
                assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: workerProfile.id }).first())[foreignKey], workerOwner.id);
                assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: survivor.id }).first())[foreignKey], other.id);
                assert.strictEqual(publicOwner.get('profile'), null);
                assert.strictEqual(record(record(await json(Owner, { id: publicOwner.id, $one: true, $include: 'profile' })).profile).id, publicProfile.id);
              }
            } catch (value) {
              failed = true;
              failure = value;
            }
            const failures: unknown[] = failed ? [failure] : [];
            if (listening) {
              try {
                call(database, 'removeListener', 'query-error', observeDriverError);
              } catch (error) {
                failures.push(error);
              }
            }
            if (failures.length === 1) throw failures[0];
            if (failures.length > 1) throw aggregate(failures);
          });
        });
      }

      it(`preserves PG hasOne cleanup and include driver errors through native ${format} with cache=${cache}`, async () => {
        await exercise(format, cache, async (fixture) => {
          const { Owner, Profile, configure, reverse } = hasOneGraph(fixture);
          configure(Owner);
          await completion((done) => call(control(Profile, 'db'), 'ensureSchema', done));
          await completion((done) => call(control(Owner, 'db'), 'ensureSchema', done));
          const { foreignKey } = reverse();
          const linked = new Profile({ title: 'linked' });
          const survivor = new Profile({ title: 'survivor' });
          await saveRelations(linked);
          await saveRelations(survivor);
          const owner = new Owner({ name: 'cleanup owner', profile: linked });
          const independent = new Owner({ name: 'independent owner', profile: null });
          await saveRelations(owner);
          await saveRelations(independent);
          await fixture.server.database.raw("create function pg_has_one_cleanup_failure() returns trigger language plpgsql as $$ begin if new.?? is null and old.?? is not null then raise exception 'owned PG hasOne cleanup failure'; end if; return new; end $$", [foreignKey, foreignKey]);
          await fixture.server.database.raw('create trigger pg_has_one_cleanup_failure before update on ?? for each row execute function pg_has_one_cleanup_failure()', ['pg_has_one_profiles']);
          let calls = 0;
          let notified: unknown;
          const returned = owner.destroy({
            error: (_model, error) => {
              calls += 1;
              notified = error;
            },
          });
          assert.ok(returned instanceof Promise);
          await assert.rejects(returned, (error: unknown) => error === notified && error instanceof Error && 'code' in error && error.code === 'P0001');
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(calls, 1);
          assert.strictEqual((await fixture.server.database('pg_has_one_owners').where({ id: owner.id }).select()).length, 0);
          assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: linked.id }).first())[foreignKey], owner.id);
          assert.strictEqual((await fixture.server.database('pg_has_one_profiles').where({ id: survivor.id }).first())[foreignKey], null);
          assert.strictEqual((await fixture.server.database('pg_has_one_owners').where({ id: independent.id }).first()).name, 'independent owner');
          await fixture.server.database.schema.dropTable('pg_has_one_profiles');
          for (const projection of [{ $select: ['name'] }, { $values: 'name' }]) {
            let callbacks = 0;
            const failure = await relationResult((done) => {
              const output = call(control(Owner, 'cursor', { id: independent.id, $include: 'profile', ...projection }), 'toJSON', (error: unknown, value: unknown) => {
                callbacks += 1;
                done(error, value);
              });
              assert.strictEqual(output, undefined);
              return output;
            }).then(
              () => {
                throw new Error('Missing hasOne table unexpectedly returned projection');
              },
              (error: unknown) => error
            );
            assert.ok(failure instanceof Error && 'code' in failure && failure.code === '42P01');
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(callbacks, 1);
            assert.ok(!failure.message.includes(fixture.server.connection.password));
          }
        });
      });
    }
  }
});

describe('PostgreSQL registered schema authority', () => {
  for (const format of ['cjs', 'esm'] as const) {
    for (const cache of [false, true]) {
      for (const first of ['child', 'parent'] as const) {
        it(`reuses the owned live schema after ${first}-first recursion from ${format} with cache=${cache}`, async () => {
          await exercise(format, cache, async (fixture) => {
            const { Child, Parent, configure, foreignKey } = relationGraph(fixture, '_authority', true);
            configure(first === 'child' ? Child : Parent, publicEntry(format));
            const parentSchema = control(Parent, 'schema');
            const childSchema = control(Child, 'schema');
            const connection = record(control(Parent, 'db')).connection;
            await relationResult((done) => call(BackboneORM.Utils, 'resetSchemas', [Child, Parent], {}, done));
            const child = new Child({ name: 'owned child' });
            const survivor = new Child({ name: 'unrelated' });
            await saveRelations(child);
            await saveRelations(survivor);
            const parent = new Parent({ name: 'owned parent', children: [child], primary: child });
            await saveRelations(parent);
            for (const entry of [publicEntry(format), publicEntry(format === 'cjs' ? 'esm' : 'cjs')]) {
              assert.ok(call(entry, 'sync', Parent) === Parent.prototype.sync);
              assert.ok(call(entry, 'sync', Child) === Child.prototype.sync);
              assert.ok(control(Parent, 'schema') === parentSchema);
              assert.ok(control(Child, 'schema') === childSchema);
              assert.ok(record(control(Parent, 'db')).connection === connection);
              assert.ok(record(control(Child, 'db')).connection === connection);
            }
            parent.set('name', 'after repeat');
            await saveRelations(parent);
            const included = record(await json(Parent, { id: parent.id, $one: true, $include: ['primary', 'children'] }));
            assert.strictEqual(record(included.primary).id, child.id);
            assert.deepStrictEqual(
              records(included.children).map((value) => value.id),
              [child.id]
            );
            assert.strictEqual(await json(Parent, { 'children.name': 'owned child', $count: true }), 1);
            const found: unknown = await call(Parent, 'find', { id: parent.id });
            assert.ok(Array.isArray(found) && found[0] instanceof Parent);
            const fetched = new Parent({ id: parent.id });
            await relationResult((done) => fetched.fetch({ success: () => done(null), error: (_model, error) => done(error) }));
            assert.strictEqual(fetched.get('name'), 'after repeat');
            const key = foreignKey();
            assert.deepStrictEqual(await fixture.server.database('pg_children_authority').orderBy('id').select('id', key), [
              { id: child.id, [key]: parent.id },
              { id: survivor.id, [key]: null },
            ]);
          });
        });
      }

      it(`keeps explicit raw schema reconfiguration through ${format} with cache=${cache}`, async () => {
        await exercise(format, cache, async ({ Item, server, db, admitted }) => {
          const connection = record(db).connection;
          let previousSchema = control(Item, 'schema');
          await completion((done) => call(db, 'createOrUpdateTable', {}, done));
          const saved = new Item({ name: 'survives raw schema', score: 4 });
          await saveRelations(saved);
          for (const rawForm of ['function', 'object'] as const) {
            const column = rawForm === 'object' ? 'raw_object' : 'raw_function';
            let rawCalls = 0;
            const rawDefinition = { name: ['String', { nullable: false }], score: 'Integer', raw_function: 'String', ...(rawForm === 'object' ? { raw_object: 'String' } : {}) };
            const rawSchema = (): object => {
              rawCalls += 1;
              return rawDefinition;
            };
            Reflect.set(Item.prototype, 'schema', rawForm === 'object' ? rawDefinition : rawSchema);
            try {
              assert.ok(call(publicEntry(format === 'cjs' ? 'esm' : 'cjs'), 'sync', Item) === Item.prototype.sync);
            } finally {
              admitted();
            }
            const nextSchema = control(Item, 'schema');
            assert.ok(nextSchema !== previousSchema);
            if (rawForm === 'function') assert.ok(rawCalls > 0);
            else assert.strictEqual(rawCalls, 0);
            assert.ok(record(control(Item, 'db')).connection === connection);
            await completion((done) => call(control(Item, 'db'), 'createOrUpdateTable', {}, done));
            saved.set(column, rawForm);
            await saveRelations(saved);
            const actual = await server.database('pg_items').where('id', relationID(saved)).first('name', 'score', column);
            assert.deepStrictEqual(actual, { name: 'survives raw schema', score: 4, [column]: rawForm });
            previousSchema = nextSchema;
          }
        });
      });
    }
  }
});

describe('PostgreSQL public package relations', () => {
  for (const format of ['cjs', 'esm'] as const) {
    for (const cache of [false, true]) {
      for (const order of ['child-first', 'parent-first'] as const) {
        it(`persists PG belongsTo/hasMany ${order} through native ${format} with cache=${cache}`, async () => {
          await exercise(format, cache, async (fixture) => {
            const { server } = fixture;
            const { Child, Parent, configure, foreignKey } = relationGraph(fixture);
            if (order === 'child-first') configure(Child);
            configure(Parent);
            const childDB = control(Child, 'db');
            const parentDB = control(Parent, 'db');
            assert.ok(record(childDB).connection === record(parentDB).connection);
            await relationResult((done) => call(BackboneORM.Utils, 'resetSchemas', [Child, Parent], {}, done));
            const key = foreignKey();
            const columns = await server.database('information_schema.columns').where({ table_schema: 'public', table_name: 'pg_children', column_name: key }).select('data_type', 'is_nullable');
            assert.deepStrictEqual(columns, [{ data_type: 'integer', is_nullable: 'YES' }]);
            const index = await server.database.raw('select indexdef from pg_indexes where tablename = ?', ['pg_children']);
            assert.ok(records(index.rows).some((row) => typeof row.indexdef === 'string' && row.indexdef.includes(key)));
            const when = new Date('2020-05-06T07:08:09.123Z');
            const first = new Child({ name: 'first', active: true, happened: when });
            const second = new Child({ name: 'second', active: false, happened: null });
            const survivor = new Child({ name: 'survivor', active: null, happened: null });
            await saveRelations(first);
            await saveRelations(second);
            await saveRelations(survivor);
            relationID(first);
            relationID(second);
            relationID(survivor);
            const parent = new Parent({ name: 'parent', score: 2, primary: null, children: [] });
            await saveRelations(parent);
            parent.set({ primary: first, children: [first, second] });
            await saveRelations(parent);
            const independent = await server.database('pg_children').orderBy('id').select('id', key);
            assert.deepStrictEqual(independent, [
              { id: first.id, [key]: parent.id },
              { id: second.id, [key]: parent.id },
              { id: survivor.id, [key]: null },
            ]);
            const included = record(await json(Parent, { id: parent.id, $one: true, $include: ['primary', 'children'] }));
            assert.strictEqual(record(included.primary).id, first.id);
            const children = records(included.children);
            assert.deepStrictEqual(children.map((row) => row.id).sort(), [first.id, second.id]);
            assert.strictEqual(children.find((row) => row.id === first.id)?.active, true);
            assert.deepStrictEqual(children.find((row) => row.id === first.id)?.happened, when);
            const reverse = record(call(Parent, 'relation', 'children')).reverse_relation;
            const reverseKey = record(reverse).key;
            assert.ok(typeof reverseKey === 'string');
            assert.strictEqual(record(record(await json(Child, { id: first.id, $one: true, $include: reverseKey }))[reverseKey]).id, parent.id);
            const found: unknown = await call(Parent, 'find', { id: parent.id, $include: ['children'] });
            assert.ok(Array.isArray(found) && found[0] instanceof Parent);
            if (cache) assert.strictEqual(found[0], parent);
            const fetched = new Parent({ id: parent.id });
            await fetched.fetch();
            assert.strictEqual(fetched.get('name'), 'parent');
            const related = records(
              await relationResult((done) =>
                call(fetched, 'get', 'children', (error: unknown, models: unknown) => {
                  if (error) done(error);
                  else {
                    assert.ok(Array.isArray(models));
                    done(
                      null,
                      models.map((model: unknown) => {
                        assert.ok(model instanceof Child);
                        return model.toJSON();
                      })
                    );
                  }
                })
              )
            );
            assert.deepStrictEqual(related.map((row) => row.id).sort(), [first.id, second.id]);
            assert.strictEqual(await json(Parent, { 'children.active': { $in: [true, false] }, $count: true }), 1);
            assert.strictEqual(await json(Parent, { 'primary.name': 'first', $count: true }), 1);
            assert.strictEqual(await json(Child, { [`${reverseKey}.name`]: 'parent', $count: true }), 2);
            assert.strictEqual(await json(Parent, { 'children.name': "first' OR 1=1 --", $count: true }), 0);
            assert.strictEqual(await json(Parent, { 'children.name': 'first', 'children.active': false, $exists: true }), false);
            const page = record(await json(Parent, { 'children.active': true, $page: true, $limit: 1, $sort: ['-score', 'id'], $include: 'children', $select: ['name'] }));
            assert.strictEqual(page.total_rows, 1);
            const projected = records(page.rows)[0];
            assert.deepStrictEqual(Object.keys(projected).sort(), ['children', 'name']);
            assert.strictEqual(records(projected.children).length, 2);
            assert.deepStrictEqual(await json(Parent, { 'children.name': 'first', $include: 'children', $values: 'name' }), ['parent']);
            assert.strictEqual(await json(Parent, { 'children.name': { $in: [] }, $count: true }), 0);
            assert.strictEqual(await json(Parent, { $or: [{ 'children.name': { $in: [] } }, { name: 'parent' }], $count: true }), 1);
            parent.set({ primary: second, children: [second] });
            await saveRelations(parent);
            assert.strictEqual((await server.database('pg_children').where({ id: first.id }).first())[key], null);
            assert.strictEqual(record(record(await json(Parent, { id: parent.id, $one: true, $include: 'primary' })).primary).id, second.id);
            parent.set({ primary: null, children: [] });
            await saveRelations(parent);
            const empty = record(await json(Parent, { id: parent.id, $one: true, $include: ['primary', 'children'] }));
            assert.strictEqual(empty.primary, null);
            assert.deepStrictEqual(empty.children, []);
            assert.strictEqual((await server.database('pg_children').where({ id: second.id }).first())[key], null);
            parent.set('children', [second]);
            await saveRelations(parent);
            await destroyRelations(parent);
            assert.strictEqual((await server.database('pg_children').where({ id: second.id }).first())[key], null);
            assert.strictEqual((await server.database('pg_children').select()).length, 3);
            assert.strictEqual((await server.database('pg_children').where({ id: survivor.id }).first()).name, 'survivor');
          });
        });
      }

      it(`adds PG live inverse columns without losing existing rows through native ${format} with cache=${cache}`, async () => {
        await exercise(format, cache, async (fixture) => {
          for (const method of ['createOrUpdateTable', 'ensureSchema'] as const) {
            const suffix = method === 'ensureSchema' ? '_ensure' : '_add';
            const { Child, Parent, configure, foreignKey } = relationGraph(fixture, suffix);
            configure(Child);
            const childDB = control(Child, 'db');
            await completion((done) => call(childDB, 'ensureSchema', done));
            await fixture.server.database.schema.alterTable(`pg_children${suffix}`, (table) => table.string('extra'));
            const existing = new Child({ name: 'existing' });
            await saveRelations(existing);
            await fixture.server.database(`pg_children${suffix}`).where({ id: existing.id }).update({ extra: 'preserved' });
            configure(Parent);
            const parentDB = control(Parent, 'db');
            await completion((done) => call(childDB, method, {}, done));
            await completion((done) => call(parentDB, 'ensureSchema', done));
            const key = foreignKey();
            assert.deepStrictEqual(await fixture.server.database(`pg_children${suffix}`).select('id', 'name', 'extra', key), [{ id: existing.id, name: 'existing', extra: 'preserved', [key]: null }]);
            const parent = new Parent({ name: 'parent', primary: existing, children: [existing] });
            await saveRelations(parent);
            assert.strictEqual((await fixture.server.database(`pg_children${suffix}`).where({ id: existing.id }).first())[key], parent.id);
            assert.strictEqual(record(record(await json(Parent, { id: parent.id, $one: true, $include: 'primary' })).primary).id, existing.id);
          }
        });
      });

      it(`retains PG driver cleanup errors and partial effects through native ${format} with cache=${cache}`, async () => {
        await exercise(format, cache, async (fixture) => {
          const { Child, Parent, configure, foreignKey } = relationGraph(fixture, '_error', true);
          configure(Parent);
          await relationResult((done) => call(BackboneORM.Utils, 'resetSchemas', [Child, Parent], {}, done));
          const child = new Child({ name: 'linked' });
          const survivor = new Child({ name: 'survivor' });
          await saveRelations(child);
          await saveRelations(survivor);
          const parent = new Parent({ name: 'parent', children: [child] });
          await saveRelations(parent);
          const key = foreignKey();
          await fixture.server.database.raw("create function pg_cleanup_failure() returns trigger language plpgsql as $$ begin if new.?? is null and old.?? is not null then raise exception 'owned PG cleanup failure'; end if; return new; end $$", [key, key]);
          await fixture.server.database.raw('create trigger pg_cleanup_failure before update on ?? for each row execute function pg_cleanup_failure()', ['pg_children_error']);
          let calls = 0;
          let notified: unknown;
          const returned = parent.destroy({
            error: (_model, error) => {
              calls += 1;
              notified = error;
            },
          });
          assert.ok(returned instanceof Promise);
          await assert.rejects(returned, (error: unknown) => error === notified && error instanceof Error && 'code' in error && error.code === 'P0001');
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(calls, 1);
          assert.strictEqual((await fixture.server.database('pg_parents_error').select()).length, 0);
          assert.strictEqual((await fixture.server.database('pg_children_error').where({ id: child.id }).first())[key], parent.id);
          assert.strictEqual((await fixture.server.database('pg_children_error').where({ id: survivor.id }).first()).name, 'survivor');
        });
      });

      it(`rejects foreign and replaced PG relation ownership before reads or mutation through native ${format} with cache=${cache}`, async () => {
        await exercise(format, cache, async (fixture) => {
          const { server, sql, admitted } = fixture;
          await server.database.raw('create database ??', ['pg_foreign']);
          class ForeignChild extends BackboneSQL.Backbone.Model {
            urlRoot = server.modelURL('pg_cross_children').replace('/postgres/', '/pg_foreign/');
            schema(): object {
              return { name: 'String' };
            }
          }
          try {
            call(sql, 'sync', ForeignChild);
          } finally {
            admitted();
          }
          const foreignDB = control(ForeignChild, 'db');
          await completion((done) => call(foreignDB, 'ensureSchema', done));
          const foreign = new ForeignChild({ name: 'foreign' });
          await saveRelations(foreign);
          assert.strictEqual(relationID(foreign), 1);
          await server.database.schema.createTable('pg_cross_children', (table) => {
            table.increments('id');
            table.string('name');
            table.integer('pg_cross_parent_id');
          });
          await server.database('pg_cross_children').insert({ id: 1, name: 'wrong parent database', pg_cross_parent_id: 1 });
          await server.database.schema.createTable('pg_cross_parents', (table) => {
            table.increments('id');
            table.string('name');
          });
          await server.database('pg_cross_parents').insert({ id: 1, name: 'parent' });
          class CrossParent extends BackboneSQL.Backbone.Model {
            urlRoot = server.modelURL('pg_cross_parents');
            schema(): object {
              return { name: 'String', children: () => ['hasMany', ForeignChild] };
            }
          }
          try {
            call(sql, 'sync', CrossParent);
          } finally {
            admitted();
          }
          const crossDB = control(CrossParent, 'db');
          const driver = call(record(crossDB).connection, 'knex');
          let queries = 0;
          const query = (): void => {
            queries += 1;
          };
          call(driver, 'on', 'query', query);
          try {
            for (const predicate of [{ $include: 'children' }, { 'children.name': 'foreign' }]) {
              let callbacks = 0;
              const result = relationResult((done) =>
                call(control(CrossParent, 'cursor', predicate), 'toJSON', (error: unknown, value: unknown) => {
                  callbacks += 1;
                  done(error, value);
                })
              );
              await assert.rejects(result, (error: unknown) => error instanceof Error && /PostgreSQL cross-database/.test(error.message) && !error.message.includes(server.connection.password));
              assert.strictEqual(callbacks, 1);
            }
            await assert.rejects(saveRelations(new CrossParent({ name: 'must not save' })), /PostgreSQL cross-database/);
            await assert.rejects(
              completion((done) => call(crossDB, 'ensureSchema', done)),
              /PostgreSQL cross-database/
            );
            await assert.rejects(
              completion((done) => call(crossDB, 'createOrUpdateTable', {}, done)),
              /PostgreSQL cross-database/
            );
            assert.strictEqual(queries, 0);
          } finally {
            call(driver, 'removeListener', 'query', query);
          }
          assert.strictEqual((await server.database('pg_cross_parents').select()).length, 1);
          assert.strictEqual((await server.database('pg_cross_children').first()).name, 'wrong parent database');

          const graph = relationGraph(fixture, '_replaced');
          graph.configure(graph.Parent);
          await relationResult((done) => call(BackboneORM.Utils, 'resetSchemas', [graph.Child, graph.Parent], {}, done));
          const original = Reflect.get(graph.Child.prototype, 'sync');
          Reflect.set(graph.Child.prototype, 'sync', BackboneSQL.Backbone.Model.prototype.sync);
          try {
            await assert.rejects(json(graph.Parent, { $include: 'children' }), /PostgreSQL related model is no longer configured/);
            await assert.rejects(json(graph.Parent, { 'children.name': 'anything', $count: true }), /PostgreSQL related model is no longer configured/);
            await assert.rejects(saveRelations(new graph.Parent({ name: 'must not save' })), /PostgreSQL related model is no longer configured/);
            await assert.rejects(
              completion((done) => call(control(graph.Parent, 'db'), 'ensureSchema', done)),
              /PostgreSQL related model is no longer configured/
            );
          } finally {
            Reflect.set(graph.Child.prototype, 'sync', original);
          }
          assert.strictEqual((await server.database('pg_parents_replaced').select()).length, 0);
        });
      });

      it(`uses one PG relation registry across native formats and rejects closed exact handles with cache=${cache} from ${format}`, async () => {
        await exercise(format, cache, async (fixture) => {
          const { Child, Parent, configure } = relationGraph(fixture, '_mixed');
          configure(Child, publicEntry(format));
          assert.strictEqual(Parent.prototype.sync, BackboneSQL.Backbone.Model.prototype.sync);
          configure(Parent, publicEntry(format === 'cjs' ? 'esm' : 'cjs'));
          const childDB = control(Child, 'db');
          const parentDB = control(Parent, 'db');
          const connection = record(parentDB).connection;
          assert.ok(connection === record(childDB).connection);
          await relationResult((done) => call(BackboneORM.Utils, 'resetSchemas', [Child, Parent], {}, done));
          const child = new Child({ name: 'mixed' });
          await saveRelations(child);
          const parent = new Parent({ name: 'mixed parent', children: [child] });
          await saveRelations(parent);
          assert.strictEqual(records(record(await json(Parent, { $one: true, $include: 'children' })).children)[0].id, child.id);
          assert.strictEqual(await json(Parent, { 'children.name': 'mixed', $count: true }), 1);
          const callbackClose = completion((done) => control(Child, 'closeConnection', done));
          const promiseClose = control(Parent, 'closeConnection');
          assert.ok(promiseClose instanceof Promise);
          await Promise.all([callbackClose, promiseClose]);
          fixture.releaseConnection(connection);
          await assert.rejects(json(Parent, { $include: 'children' }), /PostgreSQL connection is closed/);
          await assert.rejects(
            completion((done) => call(parentDB, 'ensureSchema', done)),
            /PostgreSQL connection is closed|SQL connection is closing/
          );
          assert.strictEqual((await fixture.server.database('pg_children_mixed').select()).length, 1);
        });
      });

      it(`keeps PG self relations unsupported through native ${format} with cache=${cache}`, async () => {
        await exercise(format, cache, async (fixture) => {
          class Self extends BackboneSQL.Backbone.Model {
            urlRoot = fixture.server.modelURL('pg_unsupported_self');
            schema(): object {
              return { parent: () => ['belongsTo', Self] };
            }
          }
          try {
            assert.throws(() => call(fixture.sql, 'sync', Self), /PostgreSQL self relations are not implemented/);
          } finally {
            fixture.admitted();
          }
          assert.strictEqual(await fixture.server.database.schema.hasTable('pg_unsupported_self'), false);
        });
      });
    }
  }
});

describe('PostgreSQL public package flat trial', () => {
  const cases: readonly { format: PublicFormat; cache: boolean }[] = [
    { format: 'cjs', cache: false },
    { format: 'cjs', cache: true },
    { format: 'esm', cache: false },
    { format: 'esm', cache: true },
  ];
  for (const { format, cache } of cases) {
    it(`routes collections and creation-side findOrCreate through native ${format} with cache=${cache}`, async () => {
      await exercise(format, cache, async ({ Item, server, db, sql }) => {
        await completion((done) => call(db, 'ensureSchema', done));
        const findOrCreate = (attributes: object): Promise<unknown> =>
          new Promise((resolve, reject) => {
            const returned = call(Item, 'findOrCreate', attributes, (error: unknown, model: unknown) => (error ? reject(error) : resolve(model)));
            assert.strictEqual(returned, undefined);
          });
        const input = Object.freeze({ name: 'created', score: 4 });
        const created = await findOrCreate(input);
        assert.ok(created instanceof Item);
        assert.strictEqual(typeof created.id, 'number');
        const existing = await findOrCreate(input);
        assert.ok(existing instanceof Item);
        assert.strictEqual(existing.id, created.id);
        if (cache) assert.strictEqual(existing, created);
        else assert.notStrictEqual(existing, created);
        await assert.rejects(findOrCreate({ ...input, score: 8 }), (error: unknown) => error instanceof Error && 'code' in error && error.code === '23505');
        assert.deepStrictEqual(input, { name: 'created', score: 4 });
        class Items extends BackboneSQL.Backbone.Collection<InstanceType<typeof Item>> {}
        Reflect.set(Items.prototype, 'model', Item);
        const collectionSync = call(sql, 'sync', Items);
        assert.strictEqual(typeof collectionSync, 'function');
        Reflect.set(Items.prototype, 'sync', collectionSync);
        const collection = new Items();
        await collection.fetch();
        assert.strictEqual(collection.length, 1);
        assert.strictEqual(collection.at(0).id, created.id);
        assert.strictEqual((await server.database('pg_items').select()).length, 1);
      });
    });

    it(`creates, adds columns without dropping rows, saves/fetches/finds/updates/deletes through native ${format} with cache=${cache}`, async () => {
      await exercise(format, cache, async ({ Item, server, db }) => {
        await completion((done) => call(db, 'ensureSchema', done));
        const item = new Item({ name: 'first', score: 3 });
        const survivor = new Item({ name: 'survivor', score: 9 });
        await item.save();
        await survivor.save();
        assert.ok(typeof item.id === 'number');
        const id = item.id;
        assert.ok(typeof survivor.id === 'number');
        const survivorID = survivor.id;
        assert.notStrictEqual(id, survivorID);
        await item.save({ score: 7 });
        const fetched = new Item({ id });
        await fetched.fetch();
        assert.strictEqual(fetched.get('score'), 7);
        assert.deepStrictEqual(await json(Item, { id, $select: ['name', 'score'] }), [{ name: 'first', score: 7 }]);
        await server.database.schema.alterTable('pg_items', (table) => table.string('extra_column'));
        await completion((done) => call(db, 'createOrUpdateTable', {}, done));
        assert.strictEqual(await server.database.schema.hasColumn('pg_items', 'extra_column'), true);
        assert.strictEqual((await server.database('pg_items').where({ id }).first()).name, 'first');
        await item.destroy();
        assert.strictEqual((await server.database('pg_items').where({ id }).select()).length, 0);
        assert.strictEqual((await server.database('pg_items').where({ id: survivorID }).first()).name, 'survivor');
        const missingFetch = fetched.fetch();
        assert.ok(missingFetch instanceof Promise);
        await assert.rejects(missingFetch, /Model not found/);
      });
    });

    it(`preserves legacy scalar schema types and aliases through native ${format} with cache=${cache}`, async () => {
      await exercise(format, cache, async ({ server, sql, admitted }) => {
        class ScalarItem extends BackboneSQL.Backbone.Model {
          urlRoot = server.modelURL('pg_scalar_items');
        }
        const stringDefinition = Object.freeze({ indexed: true, length: 37, nullable: false, type: 'VarChar' });
        const decimalOptions = Object.freeze({ precision: 9, scale: 3 });
        const fields = {
          alias_big: 'bIgInT', alias_bool: 'Bool', alias_string: stringDefinition, canonical_bool: 'Boolean',
          clock: 'Time', decimal_value: ['Decimal', decimalOptions], float_value: ['Float', { precision: 8, scale: 2 }],
          medium: 'MediumInt', small: 'SmallInt', tiny: ['tInYiNt', { length: 4 }], token: ['UUID', { unique: true }], wide: 'Double',
        };
        Reflect.set(ScalarItem.prototype, 'schema', fields);
        try {
          call(sql, 'sync', ScalarItem);
        } finally {
          admitted();
        }
        const db = control(ScalarItem, 'db');
        await completion((done) => call(db, 'resetSchema', {}, done));
        await server.database.schema.createTable('scalar_sentinel', (table) => table.text('value'));
        await server.database('scalar_sentinel').insert({ value: 'keep' });
        const metadata = records(await server.database('information_schema.columns').where({ table_schema: 'public', table_name: 'pg_scalar_items' })
          .select('column_name', 'data_type', 'character_maximum_length', 'numeric_precision', 'numeric_scale', 'is_nullable').orderBy('column_name'));
        assert.deepStrictEqual(metadata.map((row) => [row.column_name, row.data_type, row.character_maximum_length, row.is_nullable]), [
          ['alias_big', 'bigint', null, 'YES'], ['alias_bool', 'boolean', null, 'YES'], ['alias_string', 'character varying', 37, 'NO'],
          ['canonical_bool', 'boolean', null, 'YES'], ['clock', 'time without time zone', null, 'YES'],
          ['decimal_value', 'numeric', null, 'YES'], ['float_value', 'real', null, 'YES'], ['id', 'integer', null, 'NO'],
          ['medium', 'integer', null, 'YES'], ['small', 'smallint', null, 'YES'], ['tiny', 'smallint', null, 'YES'],
          ['token', 'uuid', null, 'YES'], ['wide', 'double precision', null, 'YES'],
        ]);
        const decimal = metadata.find((row) => row.column_name === 'decimal_value');
        assert.ok(decimal);
        assert.strictEqual(decimal.numeric_precision, 9);
        assert.strictEqual(decimal.numeric_scale, 3);
        const indexes = await server.database.raw('select indexname, indexdef from pg_indexes where schemaname = current_schema() and tablename = ?', ['pg_scalar_items']);
        assert.ok(records(indexes.rows).some((row) => row.indexname === 'pg_scalar_items_alias_string_index' && typeof row.indexdef === 'string' && !row.indexdef.includes('UNIQUE')));
        assert.ok(records(indexes.rows).some((row) => row.indexname === 'pg_scalar_items_token_unique' && typeof row.indexdef === 'string' && row.indexdef.includes('UNIQUE')));
        const firstInput = Object.freeze({ alias_big: 1099511627776, alias_bool: true, alias_string: 'first', canonical_bool: false, clock: '12:34:56', decimal_value: 4.125, float_value: 2.5, medium: 70000, small: 30000, tiny: -3, token: '01234567-89ab-4cde-8fab-0123456789ab', wide: 1.125 });
        const secondInput = Object.freeze({ ...firstInput, alias_bool: false, alias_string: 'second', canonical_bool: true, clock: null, small: -30000, token: 'fedcba98-7654-4abc-8def-0123456789ab', wide: -1.5 });
        const nativeRows = [
          { ...firstInput, alias_big: '1099511627776', decimal_value: '4.125', id: 1 },
          { ...secondInput, alias_big: '1099511627776', decimal_value: '4.125', id: 2 },
        ];
        const first = new ScalarItem(firstInput);
        const second = new ScalarItem(secondInput);
        await first.save();
        await second.save();
        assert.strictEqual(first.id, 1);
        assert.strictEqual(second.id, 2);
        assert.deepStrictEqual(await server.database('pg_scalar_items').select('*').orderBy('id'), nativeRows);
        const fetched = new ScalarItem({ id: first.id });
        await fetched.fetch();
        assert.strictEqual(fetched.get('alias_big'), cache ? 1099511627776 : '1099511627776');
        assert.strictEqual(fetched.get('alias_bool'), true);
        assert.strictEqual(fetched.get('canonical_bool'), false);
        assert.deepStrictEqual(await json(ScalarItem, { $sort: 'id' }), nativeRows);
        const found = await new Promise<unknown>((resolve, reject) => {
          const returned = call(ScalarItem, 'findOne', { id: first.id }, (error: unknown, model: unknown) => error ? reject(error) : resolve(model));
          assert.strictEqual(returned, undefined);
        });
        assert.ok(found instanceof ScalarItem);
        assert.strictEqual(found.get('alias_big'), '1099511627776');
        if (cache) assert.strictEqual(found, first);
        else assert.notStrictEqual(found, first);
        for (const [attributes, code] of [
          [{ ...firstInput, alias_string: 'duplicate token' }, '23505'],
          [{ ...firstInput, alias_string: null }, '23502'],
          [{ ...firstInput, token: 'not-a-uuid' }, '22P02'],
          [{ ...firstInput, clock: 'not-a-time' }, '22007'],
          [{ ...firstInput, alias_string: 'x'.repeat(38) }, '22001'],
          [{ ...firstInput, small: 32768 }, '22003'],
        ] as const) {
          let calls = 0;
          let notified: unknown;
          const returned = new ScalarItem(attributes).save(null, { error: (_model, error) => { calls += 1; notified = error; } });
          assert.ok(returned instanceof Promise);
          await assert.rejects(returned, (error: unknown) => error === notified && error instanceof Error && 'code' in error && error.code === code);
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(calls, 1);
          assert.deepStrictEqual(await server.database('pg_scalar_items').select('*').orderBy('id'), nativeRows);
        }
        const sync = ScalarItem.prototype.sync;
        const connection = record(db).connection;
        Reflect.set(ScalarItem.prototype, 'schema', { ...fields, extra_clock: ['Time', { nullable: true }] });
        try {
          assert.strictEqual(call(sql, 'sync', ScalarItem), sync);
        } finally {
          admitted();
        }
        const updatedDB = control(ScalarItem, 'db');
        assert.strictEqual(record(updatedDB).connection, connection);
        await completion((done) => call(updatedDB, 'ensureSchema', done));
        await completion((done) => call(updatedDB, 'ensureSchema', done));
        assert.deepStrictEqual(await server.database('pg_scalar_items').select('*').orderBy('id'), nativeRows.map((row) => ({ ...row, extra_clock: null })));
        assert.deepStrictEqual(await server.database('scalar_sentinel').select('*'), [{ value: 'keep' }]);
        assert.deepStrictEqual(stringDefinition, { indexed: true, length: 37, nullable: false, type: 'VarChar' });
        assert.deepStrictEqual(decimalOptions, { precision: 9, scale: 3 });
        assert.strictEqual(firstInput.alias_bool, true);
        assert.strictEqual(secondInput.alias_bool, false);
      });
    });


    it(`preserves authored BigIncrements string IDs through native ${format} with cache=${cache}`, async () => {
      await exercise(format, cache, async ({ server, sql, admitted }) => {
        class BigItem extends BackboneSQL.Backbone.Model {
          urlRoot = server.modelURL('pg_big_increment_items');
        }
        const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
        const reads: string[] = [];
        const getterError = new Error('PostgreSQL BigIncrements losing getter identity');
        let failGetter = false;
        let coercions = 0;
        const ignored = {
          get primaryKey(): never { coercions += 1; throw new Error('BigIncrements must not forward primaryKey options'); },
          toString(): never { coercions += 1; throw new Error('BigIncrements arguments must not be coerced'); },
        };
        const idField = { type: 'bIgInCrEmEnTs', primary: true, indexed: true, unique: true };
        for (const key of optionKeys) Object.defineProperty(idField, key, { enumerable: true, get(): unknown {
          reads.push(key);
          if (key === 'values' && failGetter) throw getterError;
          return ignored;
        } });
        Reflect.set(BigItem.prototype, 'schema', { id: idField, name: ['String', { nullable: false }] });
        try {
          call(sql, 'sync', BigItem);
        } finally {
          admitted();
        }
        assert.deepStrictEqual(reads, []);
        const db = control(BigItem, 'db');
        await completion((done) => call(db, 'resetSchema', {}, done));
        assert.deepStrictEqual(reads, optionKeys);
        reads.length = 0;
        failGetter = true;
        const metadata = records(await server.database('information_schema.columns').where({ table_schema: 'public', table_name: 'pg_big_increment_items', column_name: 'id' }).select('data_type', 'is_nullable', 'column_default'));
        assert.strictEqual(metadata.length, 1);
        assert.strictEqual(metadata[0].data_type, 'bigint');
        assert.strictEqual(metadata[0].is_nullable, 'NO');
        assert.ok(typeof metadata[0].column_default === 'string' && /^nextval\(/.test(metadata[0].column_default));
        const primary = await server.database.raw('select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = to_regclass(?) and contype = ?', ['pg_big_increment_items', 'p']);
        assert.deepStrictEqual(records(primary.rows), [{ definition: 'PRIMARY KEY (id)' }]);
        const indexes = await server.database('pg_indexes').where({ schemaname: 'public', tablename: 'pg_big_increment_items' }).select('indexname');
        assert.deepStrictEqual(records(indexes), [{ indexname: 'pg_big_increment_items_pkey' }]);
        const sequence = await server.database.raw('select pg_get_serial_sequence(?, ?) as sequence_name', ['pg_big_increment_items', 'id']);
        assert.deepStrictEqual(records(sequence.rows), [{ sequence_name: 'public.pg_big_increment_items_id_seq' }]);
        await server.database.schema.createTable('big_increment_sentinel', (table) => table.text('value'));
        await server.database('big_increment_sentinel').insert({ value: 'keep' });
        const first = new BigItem({ name: 'first' });
        const second = new BigItem({ name: 'second' });
        let successCalls = 0;
        await first.save(null, { success: () => { successCalls += 1; } });
        await second.save();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(successCalls, 1);
        assert.strictEqual(first.id, '1');
        assert.strictEqual(second.id, '2');
        assert.deepStrictEqual(await server.database('pg_big_increment_items').select('*').orderBy('id'), [{ id: '1', name: 'first' }, { id: '2', name: 'second' }]);
        const initialSequence = await server.database.raw('select last_value::text, is_called from ??', ['pg_big_increment_items_id_seq']);
        assert.deepStrictEqual(records(initialSequence.rows), [{ last_value: '2', is_called: true }]);
        await assert.rejects(server.database('pg_big_increment_items').insert({ id: '1', name: 'duplicate' }), (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === '23505');
        await first.save({ name: 'updated first' });
        const fetched = new BigItem({ id: '1' });
        await fetched.fetch();
        assert.strictEqual(fetched.id, '1');
        assert.strictEqual(fetched.get('name'), 'updated first');
        await server.database.raw('select setval(pg_get_serial_sequence(?, ?), ?::bigint, true)', ['pg_big_increment_items', 'id', '9007199254740991']);
        const highFirst = new BigItem({ name: 'above safe first' });
        const highSecond = new BigItem({ name: 'above safe second' });
        await highFirst.save();
        await highSecond.save();
        assert.strictEqual(highFirst.id, '9007199254740992');
        assert.strictEqual(highSecond.id, '9007199254740993');
        await highFirst.save({ name: 'updated above safe first' });
        const highFetched = new BigItem({ id: '9007199254740993' });
        await highFetched.fetch();
        assert.strictEqual(highFetched.id, '9007199254740993');
        assert.strictEqual(highFetched.get('name'), 'above safe second');
        const found = await relationResult((done) => call(BigItem, 'findOne', { id: '9007199254740992' }, done));
        assert.ok(found instanceof BigItem);
        assert.strictEqual(found.id, '9007199254740992');
        assert.strictEqual(found.get('name'), 'updated above safe first');
        if (cache) assert.strictEqual(found, highFirst);
        else assert.notStrictEqual(found, highFirst);
        const expected = [{ id: '1', name: 'updated first' }, { id: '2', name: 'second' }, { id: '9007199254740992', name: 'updated above safe first' }, { id: '9007199254740993', name: 'above safe second' }];
        const nativeText = await server.database.raw('select id::text as id, name from ?? order by id', ['pg_big_increment_items']);
        assert.deepStrictEqual(records(nativeText.rows), expected);
        assert.deepStrictEqual(await server.database('pg_big_increment_items').select('*').orderBy('id'), expected);
        assert.deepStrictEqual(await json(BigItem, { $sort: 'id', $select: ['id', 'name'] }), expected);
        const highSequence = await server.database.raw('select last_value::text, is_called from ??', ['pg_big_increment_items_id_seq']);
        assert.deepStrictEqual(records(highSequence.rows), [{ last_value: '9007199254740993', is_called: true }]);
        await completion((done) => call(db, 'ensureSchema', done));
        assert.deepStrictEqual(reads, []);
        assert.deepStrictEqual(await server.database('pg_big_increment_items').select('*').orderBy('id'), expected);
        await assert.rejects(completion((done) => call(db, 'resetSchema', {}, done)), (error: unknown) => error === getterError);
        assert.deepStrictEqual(reads, optionKeys);
        assert.strictEqual(await server.database.schema.hasTable('pg_big_increment_items'), false);
        assert.deepStrictEqual(await server.database('big_increment_sentinel').select('*'), [{ value: 'keep' }]);
        assert.strictEqual(coercions, 0);
      });
    });

    it(`preserves authored increments and temporal constructors through native ${format} with cache=${cache}`, async () => {
      await exercise(format, cache, async ({ server, sql, admitted }) => {
        class ConstructorItem extends BackboneSQL.Backbone.Model {
          urlRoot = server.modelURL('pg_constructor_items');
        }
        const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
        const reads: Record<string, string[]> = { id: [], observed_date: [], observed_stamp: [] };
        const getterError = new Error('PostgreSQL losing scalar constructor getter identity');
        let failGetter = false;
        let coercions = 0;
        const ignored = {
          get primaryKey(): never { coercions += 1; throw new Error('Original increments must not forward primaryKey options'); },
          get useTz(): never { coercions += 1; throw new Error('Original temporal objects must not become modern options'); },
          toString(): never { coercions += 1; throw new Error('Original scalar constructor objects must not be coerced'); },
        };
        const fields: Record<string, unknown> = { name: ['String', { nullable: false }] };
        for (const [name, type] of [['id', 'iNcReMeNtS'], ['observed_date', 'DateTime'], ['observed_stamp', 'Timestamp']]) {
          const field = { type };
          for (const key of optionKeys) Object.defineProperty(field, key, { enumerable: true, get(): unknown {
            reads[name].push(key);
            if (key === 'values' && failGetter) throw getterError;
            return ignored;
          } });
          fields[name] = field;
        }
        for (const [prefix, type] of [['date', 'DateTime'], ['stamp', 'Timestamp']]) {
          fields[`${prefix}_default`] = type;
          fields[`${prefix}_true`] = { type, value: true };
          fields[`${prefix}_false`] = { type, value: false };
          fields[`${prefix}_null`] = { type, value: null };
          fields[`${prefix}_undefined`] = { type, length: undefined, value: true };
          fields[`${prefix}_precision`] = { type, precision: 3, value: false };
          fields[`${prefix}_earlier`] = { type, textType: false, length: 5, value: true };
          fields[`${prefix}_object`] = { type, value: ignored };
          fields[`${prefix}_value_first`] = { type, value: false, values: true };
          fields[`${prefix}_values`] = { type, values: [] };
        }
        const temporalNames = Object.keys(fields).filter((name) => name !== 'id' && name !== 'name');
        const withoutTimezone = new Set(['observed_date', 'observed_stamp', 'date_true', 'stamp_true', 'date_precision', 'stamp_precision', 'date_object', 'stamp_object', 'date_values', 'stamp_values']);
        Reflect.set(ConstructorItem.prototype, 'schema', fields);
        try {
          call(sql, 'sync', ConstructorItem);
        } finally {
          admitted();
        }
        assert.deepStrictEqual(reads, { id: [], observed_date: [], observed_stamp: [] });
        const db = control(ConstructorItem, 'db');
        await completion((done) => call(db, 'resetSchema', {}, done));
        for (const list of Object.values(reads)) {
          assert.deepStrictEqual(list, optionKeys);
          list.length = 0;
        }
        failGetter = true;
        await server.database.schema.createTable('constructor_sentinel', (table) => table.text('value'));
        await server.database('constructor_sentinel').insert({ value: 'keep' });
        const metadata = records(await server.database('information_schema.columns').where({ table_schema: 'public', table_name: 'pg_constructor_items' })
          .select('column_name', 'data_type', 'datetime_precision', 'is_nullable', 'column_default').orderBy('column_name'));
        assert.deepStrictEqual(metadata.map((row) => [row.column_name, row.data_type, row.datetime_precision, row.is_nullable]), [
          ['id', 'integer', null, 'NO'], ['name', 'character varying', null, 'NO'],
          ...temporalNames.map((name) => [name, withoutTimezone.has(name) ? 'timestamp without time zone' : 'timestamp with time zone', 6, 'YES']),
        ].sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
        const idColumn = metadata.find((row) => row.column_name === 'id');
        assert.ok(idColumn && typeof idColumn.column_default === 'string' && /^nextval\(/.test(idColumn.column_default));
        const primary = await server.database.raw('select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = to_regclass(?) and contype = ?', ['pg_constructor_items', 'p']);
        assert.deepStrictEqual(records(primary.rows), [{ definition: 'PRIMARY KEY (id)' }]);
        const sequence = await server.database.raw('select pg_get_serial_sequence(?, ?) as sequence_name', ['pg_constructor_items', 'id']);
        assert.deepStrictEqual(records(sequence.rows), [{ sequence_name: 'public.pg_constructor_items_id_seq' }]);
        const input = Object.fromEntries(temporalNames.map((name) => [name, '2026-10-01T12:34:56.789+03:00']));
        const first = new ConstructorItem({ name: 'first', ...input });
        const second = new ConstructorItem({ name: 'second', ...input });
        let successCalls = 0;
        await first.save(null, { success: () => { successCalls += 1; } });
        await second.save();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(successCalls, 1);
        assert.strictEqual(first.id, 1);
        assert.strictEqual(second.id, 2);
        const nativeRows = await server.database('pg_constructor_items').select('*').orderBy('id');
        const textValues = Object.fromEntries(temporalNames.map((name) => [name, withoutTimezone.has(name) ? '2026-10-01 12:34:56.789' : '2026-10-01 09:34:56.789']));
        const formatString = 'YYYY-MM-DD HH24:MI:SS.MS';
        const textRows = await server.database('pg_constructor_items').select('id', 'name', ...temporalNames.map((name) => withoutTimezone.has(name)
          ? server.database.raw('to_char(??, ?) as ??', [name, formatString, name])
          : server.database.raw('to_char(?? AT TIME ZONE ?, ?) as ??', [name, 'UTC', formatString, name]))).orderBy('id');
        assert.deepStrictEqual(textRows, [{ id: 1, name: 'first', ...textValues }, { id: 2, name: 'second', ...textValues }]);
        const sequenceState = await server.database.raw('select last_value::text, is_called from ??', ['pg_constructor_items_id_seq']);
        assert.deepStrictEqual(records(sequenceState.rows), [{ last_value: '2', is_called: true }]);
        await assert.rejects(server.database('pg_constructor_items').insert({ id: 1, name: 'duplicate' }), (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === '23505');
        const fetched = new ConstructorItem({ id: 1 });
        await fetched.fetch();
        assert.strictEqual(fetched.get('name'), 'first');
        assert.deepStrictEqual(await json(ConstructorItem, { $sort: 'id', $select: ['id', 'name'] }), [{ id: 1, name: 'first' }, { id: 2, name: 'second' }]);
        let errorCalls = 0;
        let notified: unknown;
        const returned = new ConstructorItem({ name: null }).save(null, { error: (_model, error) => { errorCalls += 1; notified = error; } });
        assert.ok(returned instanceof Promise);
        await assert.rejects(returned, (error: unknown) => error === notified && error instanceof Error && Reflect.get(error, 'code') === '23502');
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(errorCalls, 1);
        assert.deepStrictEqual(reads, { id: [], observed_date: [], observed_stamp: [] });
        const extraReads: string[] = [];
        const extra = { type: 'Timestamp' };
        for (const key of optionKeys) Object.defineProperty(extra, key, { enumerable: true, get(): unknown { extraReads.push(key); return false; } });
        const sync = ConstructorItem.prototype.sync;
        Reflect.set(ConstructorItem.prototype, 'schema', { ...fields, extra_stamp: extra });
        try {
          assert.strictEqual(call(sql, 'sync', ConstructorItem), sync);
        } finally {
          admitted();
        }
        assert.deepStrictEqual(extraReads, []);
        const updatedDB = control(ConstructorItem, 'db');
        await completion((done) => call(updatedDB, 'ensureSchema', done));
        await completion((done) => call(updatedDB, 'ensureSchema', done));
        assert.deepStrictEqual(extraReads, optionKeys);
        assert.deepStrictEqual(reads, { id: [], observed_date: [], observed_stamp: [] });
        assert.deepStrictEqual(records(await server.database('information_schema.columns').where({ table_schema: 'public', table_name: 'pg_constructor_items', column_name: 'extra_stamp' }).select('data_type', 'datetime_precision')),
          [{ data_type: 'timestamp with time zone', datetime_precision: 6 }]);
        const extended = nativeRows.map((row) => ({ ...row, extra_stamp: null }));
        const parsed = record(control(ConstructorItem, 'schema')).fields;
        assert.ok(typeof parsed === 'object' && parsed !== null);
        Reflect.set(parsed, 'missing_date', fields.observed_date);
        let ensureCalls = 0;
        await assert.rejects(new Promise<void>((resolve, reject) => {
          const result = call(updatedDB, 'ensureSchema', (error: unknown) => { ensureCalls += 1; if (error) reject(error); else resolve(); });
          assert.strictEqual(result, undefined);
        }), (error: unknown) => error === getterError);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(ensureCalls, 1);
        assert.deepStrictEqual(reads.observed_date, optionKeys);
        assert.deepStrictEqual(reads.id, []);
        assert.deepStrictEqual(reads.observed_stamp, []);
        assert.strictEqual(await server.database.schema.hasColumn('pg_constructor_items', 'missing_date'), false);
        assert.deepStrictEqual(await server.database('pg_constructor_items').select('*').orderBy('id'), extended);
        reads.observed_date.length = 0;
        failGetter = false;
        await completion((done) => call(updatedDB, 'ensureSchema', done));
        await completion((done) => call(updatedDB, 'ensureSchema', done));
        assert.deepStrictEqual(reads.observed_date, optionKeys);
        assert.deepStrictEqual(reads.id, []);
        assert.deepStrictEqual(reads.observed_stamp, []);
        assert.deepStrictEqual(await server.database('pg_constructor_items').select('*').orderBy('id'), extended.map((row) => ({ ...row, missing_date: null })));
        failGetter = true;
        await assert.rejects(completion((done) => call(updatedDB, 'resetSchema', {}, done)), (error: unknown) => error === getterError);
        assert.strictEqual(await server.database.schema.hasTable('pg_constructor_items'), false);
        assert.deepStrictEqual(await server.database('constructor_sentinel').select('*'), [{ value: 'keep' }]);
        assert.strictEqual(coercions, 0);
      });
    });

    it(`preserves ordinary enum constructors through native ${format} with cache=${cache}`, async () => {
      await exercise(format, cache, async ({ server, sql, admitted }) => {
        class EnumItem extends BackboneSQL.Backbone.Model {
          urlRoot = server.modelURL('pg_enum_items');
        }
        const quoted = "can't";
        const sqlLooking = "x'); DROP TABLE enum_sentinel; --";
        const labels = Object.freeze(['ready', quoted, sqlLooking]);
        const scalars: unknown[] = [1, -2.5, true, false, null, undefined, NaN, Infinity, -Infinity];
        scalars.length += 1;
        Object.freeze(scalars);
        let iteratorReads = 0;
        const indexed = ['index-first', 'index-second'];
        const typed = new Uint8Array([1, 2]);
        for (const list of [indexed, typed]) Object.defineProperty(list, Symbol.iterator, { get(): never { iteratorReads += 1; throw new Error('Enum constructor iterator must not be read'); } });
        Object.freeze(indexed);
        const inherited: object = Object.create({ value: ['inherited'] });
        Reflect.set(inherited, 'type', 'Enu');
        Reflect.set(inherited, 'values', ['later']);
        const capturedLength = {
          type: 'Enum',
          get value(): unknown[] {
            const list = ['length-first', 'length-second'];
            Object.defineProperty(list, '0', { get(): string { list.push('late'); return 'length-first'; } });
            return list;
          },
        };
        const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
        const constructorReads: string[] = [];
        const getterError = new Error('PostgreSQL losing enum getter identity');
        let failGetter = false;
        const observed = { type: 'Enum' };
        for (const key of optionKeys) Object.defineProperty(observed, key, { enumerable: true, get(): string[] {
          constructorReads.push(key);
          if (key === 'values' && failGetter) throw getterError;
          return [key === 'textType' ? 'first-option' : 'losing-option'];
        } });
        const fields: Record<string, unknown> = {
          state: ['eNu', { indexed: true, nullable: false, unique: true, values: labels }],
          empty: { type: 'Enum', values: Object.freeze([]) },
          coerced: { type: 'Enu', value: scalars },
          indexed: { type: 'Enum', values: indexed },
          typed: { type: 'Enu', value: typed },
          inherited,
          captured_length: capturedLength,
          compound: { type: 'Enum', values: [['nested', 'pair'], {}] },
          value_first: { type: 'Enu', value: ['value-first'], values: ['later'] },
          observed,
        };
        const expected: Record<string, readonly string[]> = {
          state: labels, empty: [''], coerced: ['1', '-2.5', 'true', 'false', '', '', 'NaN', 'Infinity', '-Infinity', ''],
          indexed: ['index-first', 'index-second'], typed: ['1', '2'], inherited: ['inherited'], captured_length: ['length-first', 'length-second'],
          compound: ['nested,pair', '[object Object]'], value_first: ['value-first'], observed: ['first-option'],
        };
        for (const key of ['textType', 'length', 'precision', 'scale']) {
          const name = `first_${key.toLowerCase()}`;
          fields[name] = { type: 'Enum', [key]: [name], value: ['later-value'], values: ['later-values'] };
          expected[name] = [name];
        }
        Reflect.set(EnumItem.prototype, 'schema', fields);
        try {
          call(sql, 'sync', EnumItem);
        } finally {
          admitted();
        }
        assert.deepStrictEqual(constructorReads, []);
        const db = control(EnumItem, 'db');
        await completion((done) => call(db, 'resetSchema', {}, done));
        assert.deepStrictEqual(constructorReads, optionKeys);
        constructorReads.length = 0;
        failGetter = true;
        await server.database.schema.createTable('enum_sentinel', (table) => table.text('value'));
        await server.database('enum_sentinel').insert({ value: 'keep' });
        const metadata = records(await server.database('information_schema.columns').where({ table_schema: 'public', table_name: 'pg_enum_items' })
          .select('column_name', 'data_type', 'character_maximum_length', 'is_nullable').orderBy('column_name'));
        assert.deepStrictEqual(metadata.filter((row) => row.column_name !== 'id').map((row) => [row.column_name, row.data_type, row.character_maximum_length, row.is_nullable]),
          Object.keys(fields).sort().map((name) => [name, 'text', null, name === 'state' ? 'NO' : 'YES']));
        const checks = await server.database.raw('select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = to_regclass(?) and contype = ?', ['pg_enum_items', 'c']);
        assert.strictEqual(checks.rows.length, Object.keys(fields).length);
        const indexes = await server.database.raw('select indexname, indexdef from pg_indexes where schemaname = current_schema() and tablename = ?', ['pg_enum_items']);
        assert.ok(records(indexes.rows).some((row) => row.indexname === 'pg_enum_items_state_index' && typeof row.indexdef === 'string' && !row.indexdef.includes('UNIQUE')));
        assert.ok(records(indexes.rows).some((row) => row.indexname === 'pg_enum_items_state_unique' && typeof row.indexdef === 'string' && row.indexdef.includes('UNIQUE')));
        const attributes = Object.fromEntries(Object.entries(expected).map(([name, values]) => [name, values[0]]));
        const inputRows = [attributes, { ...attributes, state: quoted, empty: null }, { ...attributes, state: sqlLooking }];
        const nativeRows = inputRows.map((row, index) => ({ id: index + 1, ...row }));
        for (const row of inputRows) await new EnumItem(row).save();
        assert.deepStrictEqual(await server.database('pg_enum_items').select('*').orderBy('id'), nativeRows);
        const fetched = new EnumItem({ id: 1 });
        await fetched.fetch();
        assert.strictEqual(fetched.get('state'), 'ready');
        assert.deepStrictEqual(await json(EnumItem, { $sort: 'id' }), nativeRows);
        for (const [name, values] of Object.entries(expected)) {
          if (name === 'state') continue;
          for (const value of values) {
            await server.database('pg_enum_items').where({ id: 1 }).update({ [name]: value });
            assert.deepStrictEqual(await server.database('pg_enum_items').where({ id: 1 }).first(name), { [name]: value });
          }
        }
        await server.database('pg_enum_items').where({ id: 1 }).update(attributes);
        assert.deepStrictEqual(await server.database('pg_enum_items').select('*').orderBy('id'), nativeRows);
        const driver = call(record(db).connection, 'knex');
        const driverErrors: unknown[] = [];
        const observe = (error: unknown): void => { driverErrors.push(error); };
        call(driver, 'on', 'query-error', observe);
        try {
          for (const invalid of [{ ...attributes, state: 'unlisted' }, { ...attributes, state: null }, attributes]) {
            let calls = 0;
            let notified: unknown;
            const returned = new EnumItem(invalid).save(null, { error: (_model, error) => { calls += 1; notified = error; } });
            assert.ok(returned instanceof Promise);
            await assert.rejects(returned, (error: unknown) => error === notified && error instanceof Error && Reflect.get(error, 'code') === (invalid.state === 'unlisted' ? '23514' : invalid.state === null ? '23502' : '23505'));
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.strictEqual(calls, 1);
            assert.ok(driverErrors.includes(notified));
            assert.deepStrictEqual(await server.database('pg_enum_items').select('*').orderBy('id'), nativeRows);
          }
        } finally {
          call(driver, 'off', 'query-error', observe);
        }
        const parsed = record(control(EnumItem, 'schema')).fields;
        assert.ok(typeof parsed === 'object' && parsed !== null);
        const original = Reflect.get(parsed, 'state');
        const rejectsEnsure = async (matches: (error: unknown) => boolean): Promise<void> => {
          let calls = 0;
          await assert.rejects(new Promise<void>((resolve, reject) => {
            const returned = call(db, 'ensureSchema', (error: unknown) => { calls += 1; if (error) reject(error); else resolve(); });
            assert.strictEqual(returned, undefined);
          }), matches);
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(calls, 1);
          assert.deepStrictEqual(await server.database('pg_enum_items').select('*').orderBy('id'), nativeRows);
        };
        try {
          Reflect.set(parsed, 'state', { type: 'Enum' });
          await completion((done) => call(db, 'ensureSchema', done));
          Reflect.set(parsed, 'missing_enum', { type: 'Enum' });
          await rejectsEnsure((error) => error instanceof TypeError);
          for (const key of optionKeys) {
            for (const invalid of [undefined, null, 'scalar', 0, false, {}]) {
              Reflect.set(parsed, 'state', { type: 'Enu', values: ['fallback'], [key]: invalid });
              Reflect.deleteProperty(parsed, 'missing_enum');
              await completion((done) => call(db, 'ensureSchema', done));
              Reflect.set(parsed, 'missing_enum', { type: 'Enu', values: ['fallback'], [key]: invalid });
              await rejectsEnsure((error) => error instanceof TypeError);
            }
          }
          const coercionError = new Error('Enum entry coercion identity');
          Reflect.set(parsed, 'state', { type: 'Enum', values: [{ toString(): never { throw coercionError; } }] });
          Reflect.deleteProperty(parsed, 'missing_enum');
          await completion((done) => call(db, 'ensureSchema', done));
          Reflect.set(parsed, 'missing_enum', Reflect.get(parsed, 'state'));
          await rejectsEnsure((error) => error === coercionError);
          let calls = 0;
          const returned = new EnumItem({ id: 1, ...attributes }).save(null, { success: () => { calls += 1; } });
          assert.ok(returned instanceof Promise);
          await returned;
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert.strictEqual(calls, 1);
          assert.deepStrictEqual(await server.database('pg_enum_items').select('*').orderBy('id'), nativeRows);
          Reflect.set(parsed, 'missing_enum', { type: 'Enum', values: [Symbol('not a label')] });
          await rejectsEnsure((error) => error instanceof TypeError);
          assert.deepStrictEqual(constructorReads, []);
          Reflect.set(parsed, 'missing_enum', observed);
          await rejectsEnsure((error) => error === getterError);
          assert.deepStrictEqual(constructorReads, optionKeys);
          constructorReads.length = 0;
          assert.strictEqual(await server.database.schema.hasColumn('pg_enum_items', 'missing_enum'), false);
        } finally {
          Reflect.deleteProperty(parsed, 'missing_enum');
          Reflect.set(parsed, 'state', original);
        }
        const sync = EnumItem.prototype.sync;
        let extraReads = 0;
        const extra = { type: 'Enum', nullable: true, get values(): string[] { extraReads += 1; return ['extra']; } };
        Reflect.set(EnumItem.prototype, 'schema', { ...fields, extra_enum: extra });
        try {
          assert.strictEqual(call(sql, 'sync', EnumItem), sync);
        } finally {
          admitted();
        }
        assert.deepStrictEqual(constructorReads, []);
        assert.strictEqual(extraReads, 0);
        const updatedDB = control(EnumItem, 'db');
        await completion((done) => call(updatedDB, 'ensureSchema', done));
        assert.strictEqual(extraReads, 1);
        await completion((done) => call(updatedDB, 'ensureSchema', done));
        assert.strictEqual(extraReads, 1);
        assert.deepStrictEqual(constructorReads, []);
        const extendedRows = nativeRows.map((row) => ({ ...row, extra_enum: null }));
        assert.deepStrictEqual(await server.database('pg_enum_items').select('*').orderBy('id'), extendedRows);
        const currentFields = record(control(EnumItem, 'schema')).fields;
        assert.ok(typeof currentFields === 'object' && currentFields !== null);
        Reflect.set(currentFields, 'state', { type: 'Enum', values: ['new-label'] });
        await completion((done) => call(updatedDB, 'ensureSchema', done));
        const laterChecks = await server.database.raw('select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = to_regclass(?) and contype = ?', ['pg_enum_items', 'c']);
        const originalChecks = records(checks.rows);
        assert.deepStrictEqual(records(laterChecks.rows).filter((row) => originalChecks.some((prior) => prior.conname === row.conname)).sort((a, b) => String(a.conname).localeCompare(String(b.conname))),
          originalChecks.sort((a, b) => String(a.conname).localeCompare(String(b.conname))));
        await assert.rejects(server.database('pg_enum_items').where({ id: 1 }).update({ state: 'new-label' }), (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === '23514');
        assert.deepStrictEqual(await server.database('pg_enum_items').select('*').orderBy('id'), extendedRows);
        assert.deepStrictEqual(await server.database('enum_sentinel').select('*'), [{ value: 'keep' }]);
        assert.deepStrictEqual(labels, ['ready', quoted, sqlLooking]);
        assert.deepStrictEqual(indexed.slice(), ['index-first', 'index-second']);
        assert.strictEqual(typed[0], 1);
        assert.strictEqual(typed[1], 2);
        assert.strictEqual(iteratorReads, 0);
        assert.strictEqual(9 in scalars, false);
        Reflect.set(currentFields, 'state', observed);
        let resetCalls = 0;
        await assert.rejects(new Promise<void>((resolve, reject) => {
          const returned = call(updatedDB, 'resetSchema', {}, (error: unknown) => { resetCalls += 1; if (error) reject(error); else resolve(); });
          assert.strictEqual(returned, undefined);
        }), (error: unknown) => error === getterError);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(resetCalls, 1);
        assert.deepStrictEqual(constructorReads, optionKeys);
        assert.strictEqual(await server.database.schema.hasTable('pg_enum_items'), false);
        assert.deepStrictEqual(await server.database('enum_sentinel').select('*'), [{ value: 'keep' }]);
      });
    });

    it(`preserves native Boolean/DateTime/JSON reads, projections and pagination through native ${format} with cache=${cache}`, async () => {
      await exercise(format, cache, async ({ Item, server, db }) => {
        await completion((done) => call(db, 'resetSchema', {}, done));
        const instant = new Date('2026-10-01T12:34:56.789Z');
        for (const attributes of [
          { name: 'true', score: 10, group_id: 1, active: true, created_at: instant, json_data: { key: 'value' } },
          { name: 'false', score: 10, group_id: 1, active: false, created_at: null, json_data: null },
          { name: 'null', score: 3, group_id: 2, active: null, created_at: null, json_data: null },
        ])
          await new Item(attributes).save();
        const native = await server.database('pg_items').orderBy('id');
        assert.ok(native[0].created_at instanceof Date);
        assert.strictEqual(native[0].created_at.toISOString(), instant.toISOString());
        assert.deepStrictEqual(native[0].json_data, { key: 'value' });
        const rows = await json(Item, { $sort: ['-score', 'id'] });
        assert.deepStrictEqual(rows, native);
        assert.deepStrictEqual(await json(Item, { $sort: 'id', $values: ['active'] }), [true, false, null]);
        assert.deepStrictEqual(await json(Item, { $sort: 'id', $values: ['name', 'score'] }), [
          ['true', 10],
          ['false', 10],
          ['null', 3],
        ]);
        assert.strictEqual(await json(Item, { $count: true }), 3);
        assert.strictEqual(await json(Item, { score: { $gte: 10 }, $exists: true }), true);
        assert.deepStrictEqual(await json(Item, { name: { $in: [] } }), []);
        assert.deepStrictEqual(await json(Item, { $sort: 'id', $or: [{ name: { $in: [] } }, { name: 'null' }] }), [native[2]]);
        assert.deepStrictEqual(await json(Item, { $unique: ['group_id'], $sort: ['-score', 'id'], $select: ['id', 'group_id', 'score'] }), [
          { id: native[0].id, group_id: 1, score: 10 },
          { id: native[2].id, group_id: 2, score: 3 },
        ]);
        assert.deepStrictEqual(await json(Item, { $unique: ['group_id'], $sort: '-score', $select: ['name', 'score'] }), [
          { name: 'true', score: 10 },
          { name: 'null', score: 3 },
        ]);
        assert.deepStrictEqual(await json(Item, { $unique: ['group_id'], $sort: '-score', $select: ['id'] }), [{ id: native[0].id }, { id: native[2].id }]);
        assert.deepStrictEqual(await json(Item, { $unique: ['group_id'], $sort: ['-score', 'name'], $select: ['name'] }), [{ name: 'false' }, { name: 'null' }]);
        assert.deepStrictEqual(await json(Item, { $unique: ['group_id'], $select: ['name'] }), [{ name: 'true' }, { name: 'null' }]);
        assert.deepStrictEqual(await json(Item, { $unique: ['group_id'], $sort: '-score', $values: ['name'] }), ['true', 'null']);
        assert.deepStrictEqual(await json(Item, { $unique: ['group_id'], $sort: '-score', $select: ['name'], $page: true, $offset: 1, $limit: 1 }), {
          offset: 1,
          total_rows: 2,
          rows: [{ name: 'null' }],
        });
        assert.deepStrictEqual(await json(Item, { active: false, $unique: ['group_id'], $sort: '-score', $select: ['name'], $page: true, $limit: 1 }), {
          offset: 0,
          total_rows: 1,
          rows: [{ name: 'false' }],
        });
        assert.deepStrictEqual(await server.database('pg_items').orderBy('id'), native);
        assert.deepStrictEqual(await json(Item, { $page: true, $offset: 1, $limit: 1, $sort: ['-score', 'id'] }), { offset: 1, total_rows: 3, rows: [native[1]] });
      });
    });

    it(`preserves original driver errors and rejects unsupported URL/options before DDL through native ${format} with cache=${cache}`, async () => {
      await exercise(format, cache, async ({ Item, server, db, sql }) => {
        await completion((done) => call(db, 'ensureSchema', done));
        await new Item({ name: 'duplicate' }).save();
        let calls = 0;
        let notified: unknown;
        const returned = new Item({ name: 'duplicate' }).save(null, {
          error: (_model, error) => {
            calls += 1;
            notified = error;
          },
        });
        assert.ok(returned instanceof Promise);
        await assert.rejects(returned, (error: unknown) => error === notified && error instanceof Error && 'code' in error && error.code === '23505');
        assert.strictEqual(calls, 1);
        const notNull = new Item();
        const missing = notNull.save();
        assert.ok(missing instanceof Promise);
        await assert.rejects(missing, (error: unknown) => error instanceof Error && 'code' in error && error.code === '23502');
        for (const suffix of ['?sslmode=require', '?', '#fragment']) {
          class Invalid extends BackboneSQL.Backbone.Model {
            urlRoot = `${server.modelURL('must_not_exist')}${suffix}`;
          }
          assert.throws(() => call(sql, 'sync', Invalid), /query, SSL and fragment/);
        }
        class Filename extends BackboneSQL.Backbone.Model {
          urlRoot = server.modelURL('must_not_exist');
        }
        assert.throws(() => call(sql, 'sync', Filename, { filename: 'not-postgres.sqlite3' }), /filename option/);
        assert.throws(() => call(sql, 'sync', Filename, { slaves: ['postgres://localhost/db/items'] }), /slave connections/);
        assert.strictEqual(await server.database.schema.hasTable('must_not_exist'), false);
        assert.strictEqual((await server.database('pg_items').select()).length, 1);
      });
    });
  }

  for (const cache of [false, true]) {
    it(`shares one exact PostgreSQL handle between native CJS and ESM and closes both interfaces with cache=${cache}`, async () => {
      await exercise('cjs', cache, async ({ Item, server, db, admitted, releaseConnection }) => {
        class Peer extends BackboneSQL.Backbone.Model<ItemAttributes> {
          urlRoot = server.modelURL('pg_items');
        }
        Reflect.set(Peer.prototype, 'schema', { name: 'String' });
        try {
          BackboneSQL.sync(Peer);
        } finally {
          admitted();
        }
        const peerDB = control(Peer, 'db');
        assert.ok(typeof db === 'object' && db !== null);
        assert.ok(typeof peerDB === 'object' && peerDB !== null);
        const connection: unknown = Reflect.get(db, 'connection');
        assert.ok(typeof connection === 'object' && connection !== null);
        assert.strictEqual(Reflect.get(peerDB, 'connection'), connection);
        const key: unknown = Reflect.get(connection, 'url');
        assert.ok(typeof key === 'string');
        assert.strictEqual(BackboneORM.ConnectionPool.get(key), connection);
        await completion((done) => call(db, 'ensureSchema', done));
        await new Item({ name: 'shared' }).save();
        assert.deepStrictEqual(await json(Peer, { $values: ['name'] }), ['shared']);

        const database = call(connection, 'knex');
        const backend: unknown = await call(database, 'raw', 'select pg_backend_pid() as pid');
        assert.ok(typeof backend === 'object' && backend !== null);
        const backendRows: unknown = Reflect.get(backend, 'rows');
        assert.ok(Array.isArray(backendRows));
        assert.strictEqual(backendRows.length, 1);
        const pid: unknown = Reflect.get(backendRows[0], 'pid');
        assert.ok(typeof pid === 'number');
        const active = await server.database.raw('select count(*)::integer as count from pg_stat_activity where pid = ?', [pid]);
        assert.strictEqual(active.rows[0].count, 1);

        let callbacks = 0;
        const promiseClose = control(Item, 'closeConnection');
        assert.ok(promiseClose instanceof Promise);
        const callbackClose = new Promise<void>((resolve, reject) => {
          const returned = control(Peer, 'closeConnection', (error: unknown) => {
            callbacks += 1;
            if (error) reject(error);
            else resolve();
          });
          assert.strictEqual(returned, undefined);
        });
        const closes = await Promise.allSettled([promiseClose, callbackClose]);
        const closeFailures: unknown[] = [];
        for (const result of closes) if (result.status === 'rejected') closeFailures.push(result.reason);
        if (closeFailures.length === 1) throw closeFailures[0];
        if (closeFailures.length > 1) throw aggregate(closeFailures);
        assert.strictEqual(callbacks, 1);
        assert.strictEqual(BackboneORM.ConnectionPool.get(key), undefined);
        releaseConnection(connection);
        const closed = await server.database.raw('select count(*)::integer as count from pg_stat_activity where pid = ?', [pid]);
        assert.strictEqual(closed.rows[0].count, 0);
        assert.strictEqual((await server.database('pg_items').where({ name: 'shared' }).select()).length, 1);
      });
    });
  }
});

async function identifierPrimaryIndex(fixture: Awaited<ReturnType<typeof startFixture>>, table: string): Promise<string> {
  const result = await fixture.server.database.raw(
    "select i.relname as indexname, pg_get_constraintdef(c.oid) as definition from pg_constraint c join pg_class i on i.oid = c.conindid where c.conrelid = to_regclass(?) and c.contype = 'p'",
    [table]
  );
  const primary = records(result.rows);
  assert.strictEqual(primary.length, 1);
  assert.strictEqual(primary[0].definition, 'PRIMARY KEY (id)');
  const index: unknown = primary[0].indexname;
  assert.ok(typeof index === 'string');
  return index;
}

function identifierBoundaryGraph(fixture: Awaited<ReturnType<typeof startFixture>>) {
  const courseTable = 'a'.repeat(18) + '_courses';
  const studentTable = 'b'.repeat(18) + '_students';
  const courseKey = 'aa';
  const studentKey = 'bb';
  class Course extends BackboneSQL.Backbone.Model {
    urlRoot = fixture.server.modelURL(courseTable);
    schema(): object {
      return { title: 'String', students: () => ['hasMany', Student, { as: 'courses', join_key: courseKey, foreign_key: 'course_alias' }] };
    }
  }
  class Student extends BackboneSQL.Backbone.Model {
    urlRoot = fixture.server.modelURL(studentTable);
    schema(): object {
      return { name: 'String', score: 'Integer', courses: () => ['hasMany', Course, { as: 'students', join_key: studentKey, foreign_key: 'student_alias' }] };
    }
  }
  try {
    call(fixture.sql, 'sync', Student);
  } finally {
    fixture.admitted();
  }
  const relation = call(Student, 'relation', 'courses');
  assert.ok(typeof relation === 'object' && relation !== null);
  const type: unknown = Reflect.get(relation, 'join_table');
  assert.ok(typeof type === 'function');
  const pivotTable: unknown = control(type, 'tableName');
  assert.ok(typeof pivotTable === 'string');
  assert.strictEqual(pivotTable, courseTable + '_' + studentTable);
  assert.strictEqual(Reflect.get(relation, 'join_key'), studentKey);
  const reverse: unknown = Reflect.get(relation, 'reverse_relation');
  assert.ok(typeof reverse === 'object' && reverse !== null);
  assert.strictEqual(Reflect.get(reverse, 'join_key'), courseKey);
  return { Student, Course, type, courseTable, studentTable, pivotTable, courseKey, studentKey, db: control(Student, 'db') };
}

describe('PostgreSQL public package identifier boundaries', () => {
  const format = 'cjs';
  it('preserves 63-byte automatic index and unindexed column identities through native ' + format, async () => {
    await exercise(format, false, async (fixture) => {
      const table = 'p'.repeat(54);
      const column = 'c'.repeat(63);
      const index = table + '_ix_index';
      assert.strictEqual(Buffer.byteLength(index), 63);
      assert.strictEqual(Buffer.byteLength(column), 63);
      class Boundary extends BackboneSQL.Backbone.Model {
        urlRoot = fixture.server.modelURL(table);
        schema(): object {
          return { [column]: 'String', ix: ['Integer', { indexed: true }] };
        }
      }
      try {
        call(fixture.sql, 'sync', Boundary);
      } finally {
        fixture.admitted();
      }
      const db = control(Boundary, 'db');
      assert.ok(record(db).connection === record(fixture.db).connection, 'Boundary model must use the exact acquired handle');
      await completion((done) => call(db, 'ensureSchema', done));
      const fields = record(record(control(Boundary, 'schema')).fields);
      assert.strictEqual(record(fields.ix).indexed, true);
      const model = new Boundary({ [column]: 'boundary survivor', ix: 37 });
      await saveRelations(model);
      const id = relationID(model);
      const native = await fixture.server.database(table).where({ id }).first();
      assert.strictEqual(native[column], 'boundary survivor');
      assert.strictEqual(native.ix, 37);
      const indexes = await fixture.server.database.raw('select indexname from pg_indexes where schemaname = current_schema() and tablename = ?', [table]);
      assert.ok(records(indexes.rows).some((row) => row.indexname === index));
      const primaryIndex = await identifierPrimaryIndex(fixture, table);
      assert.ok(primaryIndex !== index, 'The primary index is separate from the indexed Integer boundary');
      assert.ok(records(indexes.rows).some((row) => row.indexname === primaryIndex));
      assert.deepStrictEqual(await json(Boundary, { id, $values: [column] }), ['boundary survivor']);
    });
  });


  it('preserves a generated 54-byte pivot with exact 63-byte join-key indexes through native ' + format, async () => {
    await exercise(format, false, async (fixture) => {
      const graph = identifierBoundaryGraph(fixture);
      assert.strictEqual(Buffer.byteLength(graph.pivotTable), 54);
      const expectedIndexes = [graph.studentKey, graph.courseKey].map((key) => graph.pivotTable + '_' + key + '_index');
      for (const index of expectedIndexes) assert.strictEqual(Buffer.byteLength(index), 63);
      const pivotFields = record(record(control(graph.type, 'schema')).fields);
      for (const key of [graph.studentKey, graph.courseKey]) assert.strictEqual(record(pivotFields[key]).indexed, true);
      await completion((done) => call(graph.db, 'ensureSchema', done));
      await completion((done) => call(control(graph.Course, 'db'), 'ensureSchema', done));
      const course = new graph.Course({ title: 'boundary course' });
      await saveRelations(course);
      const student = new graph.Student({ name: 'boundary student', courses: [course] });
      await saveRelations(student);
      const links = await fixture.server.database(graph.pivotTable).select(graph.studentKey, graph.courseKey);
      assert.deepStrictEqual(links, [{ [graph.studentKey]: relationID(student), [graph.courseKey]: relationID(course) }]);
      const indexes = await fixture.server.database.raw('select indexname from pg_indexes where schemaname = current_schema() and tablename = ?', [graph.pivotTable]);
      for (const index of expectedIndexes) assert.ok(records(indexes.rows).some((row) => row.indexname === index));
      const primaryIndex = await identifierPrimaryIndex(fixture, graph.pivotTable);
      assert.ok(!expectedIndexes.includes(primaryIndex), 'The primary index is separate from the join-key boundaries');
      assert.ok(records(indexes.rows).some((row) => row.indexname === primaryIndex));
      const included = records(await json(graph.Student, { id: student.id, $include: 'courses' }));
      assert.strictEqual(included.length, 1);
      assert.deepStrictEqual(records(included[0].courses).map((row) => row.id), [relationID(course)]);
    });
  });
});

type IdentifierOutcome = { ok: true; value: unknown } | { ok: false; error: unknown };

async function captureIdentifierOutcome(operation: () => Promise<unknown>): Promise<IdentifierOutcome> {
  try { return { ok: true, value: await operation() }; } catch (error) { return { ok: false, error }; }
}

function identifierOutcomeSummary(outcome: IdentifierOutcome): unknown {
  if (outcome.ok) return outcome;
  const error = outcome.error;
  return { ok: false, error: error instanceof Error ? { name: error.name, message: error.message, code: Reflect.get(error, 'code') } : { type: typeof error } };
}

async function observeIdentifierControl(db: unknown, method: 'ensureSchema' | 'resetSchema', inspections: Record<string, () => Promise<unknown>>) {
  const database = call(record(db).connection, 'knex');
  const ddl: string[] = [];
  const nativeErrors: Array<{ error: Error; sql: string }> = [];
  const track = (query: { sql: string }): void => { if (/^(create|alter|drop)\s/i.test(query.sql)) ddl.push(query.sql); };
  const failed = (error: Error, query: { sql: string }): void => { nativeErrors.push({ error, sql: query.sql }); };
  call(database, 'on', 'query', track);
  call(database, 'on', 'query-error', failed);
  let calls = 0;
  let returned: unknown;
  const outcome = await captureIdentifierOutcome(() => new Promise<void>((resolve, reject) => {
    returned = call(db, method, {}, (error: unknown) => {
      calls += 1;
      if (error !== null && error !== undefined) reject(error); else resolve();
    });
  }));
  const listenerErrors: unknown[] = [];
  for (const [event, listener] of [['query', track], ['query-error', failed]] as const) {
    try { call(database, 'removeListener', event, listener); } catch (error) { listenerErrors.push(error); }
  }
  const reads: Record<string, IdentifierOutcome> = {};
  for (const [name, inspect] of Object.entries(inspections)) reads[name] = await captureIdentifierOutcome(inspect);
  process.stdout.write(`SQL_IDENTIFIER_OBSERVATION ${JSON.stringify({
    operation: identifierOutcomeSummary(outcome), callbackCalls: calls, returnedVoid: returned === undefined, ddl,
    nativeErrors: nativeErrors.map(({ error, sql }) => ({ sql, outcome: identifierOutcomeSummary({ ok: false, error }) })),
    reads: Object.fromEntries(Object.entries(reads).map(([name, read]) => [name, identifierOutcomeSummary(read)])),
    listenerErrors: listenerErrors.map((error) => identifierOutcomeSummary({ ok: false, error })),
  })}\n`);
  return { outcome, calls, returned, ddl, nativeErrors, reads, listenerErrors };
}

function identifierRead(read: IdentifierOutcome): unknown {
  if (!read.ok) throw read.error;
  return read.value;
}

function longIdentifierGraph(fixture: Awaited<ReturnType<typeof startFixture>>) {
  const courseTable = 'family_pg_pivot_courses_cjs_offs';
  const studentTable = 'family_pg_pivot_students_cjs_offs';
  const courseKey = 'pivot_course_id';
  const studentKey = 'pivot_student_id';
  class Course extends BackboneSQL.Backbone.Model {
    urlRoot = fixture.server.modelURL(courseTable);
    schema(): object { return { title: 'String', students: () => ['hasMany', Student, { as: 'courses', join_key: courseKey, foreign_key: 'course_alias' }] }; }
  }
  class Student extends BackboneSQL.Backbone.Model {
    urlRoot = fixture.server.modelURL(studentTable);
    schema(): object { return { name: 'String', score: 'Integer', courses: () => ['hasMany', Course, { as: 'students', join_key: studentKey, foreign_key: 'student_alias' }] }; }
  }
  try { call(fixture.sql, 'sync', Student); } finally { fixture.admitted(); }
  const relation = record(call(Student, 'relation', 'courses'));
  const type: unknown = relation.join_table;
  assert.ok(typeof type === 'function');
  const pivotTable: unknown = control(type, 'tableName');
  assert.ok(typeof pivotTable === 'string');
  assert.strictEqual(pivotTable, courseTable + '_' + studentTable);
  assert.strictEqual(relation.join_key, studentKey);
  assert.strictEqual(record(relation.reverse_relation).join_key, courseKey);
  assert.strictEqual(Buffer.byteLength(pivotTable), 66);
  assert.strictEqual(Buffer.byteLength(pivotTable + '_' + courseKey + '_index'), 88);
  const db = control(Student, 'db');
  assert.ok(record(db).connection === record(fixture.db).connection, 'Graph uses the exact acquired SQL handle');
  return { Student, Course, type, db, courseTable, studentTable, pivotTable, courseKey, studentKey };
}

async function seedLongIdentifierEndpoints(fixture: Awaited<ReturnType<typeof startFixture>>, graph: ReturnType<typeof longIdentifierGraph>, includeScore = true): Promise<void> {
  await fixture.server.database.schema.createTable(graph.studentTable, (builder) => { builder.increments('id'); builder.string('name'); if (includeScore) builder.integer('score'); });
  await fixture.server.database.schema.createTable(graph.courseTable, (builder) => { builder.increments('id'); builder.string('title'); });
  await fixture.server.database(graph.studentTable).insert({ id: 7, name: 'student survivor', ...(includeScore ? { score: 11 } : {}) });
  await fixture.server.database(graph.courseTable).insert({ id: 9, title: 'course survivor' });
}

function identifierNativeFailure(observed: Awaited<ReturnType<typeof observeIdentifierControl>>, prefix: string): void {
  assert.strictEqual(observed.returned, undefined);
  assert.strictEqual(observed.calls, 1);
  assert.deepStrictEqual(observed.listenerErrors, []);
  if (observed.outcome.ok) assert.fail('Source-derived native collision was not observed');
  const error = observed.outcome.error;
  assert.ok(error instanceof Error);
  if (Reflect.get(error, 'code') !== '42P07') throw error;
  assert.ok(observed.nativeErrors.some((failure) => failure.error === error && failure.sql.startsWith(prefix)), 'Required callback preserves the exact native operation Error and failing DDL phase');
}

describe('PostgreSQL public package identifier observations', () => {
  it('observes fresh generated pivot66 failing at index creation through native CJS', async () => {
    await exercise('cjs', false, async (fixture) => {
      const graph = longIdentifierGraph(fixture);
      await seedLongIdentifierEndpoints(fixture, graph, false);
      const physical = graph.pivotTable.slice(0, 63);
      assert.strictEqual(await fixture.server.database.schema.hasTable(physical), false);
      assert.strictEqual(await fixture.server.database.schema.hasColumn(graph.studentTable, 'score'), false);
      const observed = await observeIdentifierControl(graph.db, 'ensureSchema', {
        pivot: () => fixture.server.database(physical).select('id', graph.studentKey, graph.courseKey),
        student: () => fixture.server.database(graph.studentTable).select('id', 'name', 'score'),
        course: () => fixture.server.database(graph.courseTable).select('id', 'title'),
        indexes: async () => (await fixture.server.database.raw('select indexname from pg_indexes where schemaname = current_schema() and tablename = ?', [physical])).rows,
      });
      identifierNativeFailure(observed, 'create index');
      assert.ok(observed.ddl[0].startsWith('alter table "' + graph.studentTable + '"'));
      assert.ok(observed.ddl.some((sql) => sql.startsWith('create table "' + graph.pivotTable + '"')));
      assert.ok(observed.ddl.some((sql) => sql.startsWith('create index')));
      assert.deepStrictEqual(identifierRead(observed.reads.pivot), []);
      assert.deepStrictEqual(identifierRead(observed.reads.student), [{ id: 7, name: 'student survivor', score: null }]);
      assert.deepStrictEqual(identifierRead(observed.reads.course), [{ id: 9, title: 'course survivor' }]);
      assert.ok(records(identifierRead(observed.reads.indexes)).every((row) => row.indexname !== physical));
    });
  });

  it('observes public ensure against a preexisting truncated physical pivot through native CJS', async () => {
    await exercise('cjs', false, async (fixture) => {
      const graph = longIdentifierGraph(fixture);
      await seedLongIdentifierEndpoints(fixture, graph);
      const physical = graph.pivotTable.slice(0, 63);
      await fixture.server.database.schema.createTable(physical, (builder) => { builder.integer('id'); builder.integer(graph.studentKey); builder.integer(graph.courseKey); builder.string('marker'); });
      await fixture.server.database(physical).insert({ id: 37, [graph.studentKey]: 7, [graph.courseKey]: 9, marker: 'preexisting pivot survivor' });
      const physicalMetadata = await captureIdentifierOutcome(() => fixture.server.database.schema.hasTable(physical));
      const requestedMetadata = await captureIdentifierOutcome(() => fixture.server.database.schema.hasTable(graph.pivotTable));
      const textMetadata = await captureIdentifierOutcome(async () => (await fixture.server.database.raw(
        'select exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name::text = ?::text) as requested_text_equal, exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name::text = ?::text) as physical_text_equal',
        [graph.pivotTable, physical]
      )).rows);
      const observed = await observeIdentifierControl(graph.db, 'ensureSchema', {
        physicalHasTable: async () => identifierRead(physicalMetadata),
        requestedHasTable: async () => identifierRead(requestedMetadata),
        exactTextMetadata: async () => identifierRead(textMetadata),
        pivot: () => fixture.server.database(physical).select('id', graph.studentKey, graph.courseKey, 'marker'),
        student: () => fixture.server.database(graph.studentTable).select('id', 'name', 'score'),
        course: () => fixture.server.database(graph.courseTable).select('id', 'title'),
      });
      if (!observed.outcome.ok) throw observed.outcome.error;
      assert.strictEqual(observed.returned, undefined);
      assert.strictEqual(observed.calls, 1);
      assert.deepStrictEqual(observed.listenerErrors, []);
      assert.strictEqual(identifierRead(observed.reads.physicalHasTable), true);
      assert.strictEqual(identifierRead(observed.reads.requestedHasTable), true);
      assert.deepStrictEqual(identifierRead(observed.reads.exactTextMetadata), [{ requested_text_equal: false, physical_text_equal: true }]);
      assert.deepStrictEqual(identifierRead(observed.reads.pivot), [{ id: 37, [graph.studentKey]: 7, [graph.courseKey]: 9, marker: 'preexisting pivot survivor' }]);
      assert.deepStrictEqual(identifierRead(observed.reads.student), [{ id: 7, name: 'student survivor', score: 11 }]);
      assert.deepStrictEqual(identifierRead(observed.reads.course), [{ id: 9, title: 'course survivor' }]);
    });
  });

  it('observes valid repeated ensure as a no-DDL operation on its owned indexed graph through native CJS', async () => {
    await exercise('cjs', false, async (fixture) => {
      const graph = identifierBoundaryGraph(fixture);
      assert.ok(record(graph.db).connection === record(fixture.db).connection, 'Graph uses the exact acquired SQL handle');
      await completion((done) => call(graph.db, 'ensureSchema', done));
      await completion((done) => call(control(graph.Course, 'db'), 'ensureSchema', done));
      const course = new graph.Course({ title: 'owned course' });
      await saveRelations(course);
      const student = new graph.Student({ name: 'owned student', courses: [course] });
      await saveRelations(student);
      const links = await fixture.server.database(graph.pivotTable).select('id', graph.studentKey, graph.courseKey);
      const before = records((await fixture.server.database.raw('select indexname from pg_indexes where schemaname = current_schema() and tablename = ? order by indexname', [graph.pivotTable])).rows);
      for (const key of [graph.studentKey, graph.courseKey]) assert.ok(before.some((row) => row.indexname === graph.pivotTable + '_' + key + '_index'));
      const observed = await observeIdentifierControl(graph.db, 'ensureSchema', {
        pivot: () => fixture.server.database(graph.pivotTable).select('id', graph.studentKey, graph.courseKey),
        student: () => fixture.server.database(graph.studentTable).select('id', 'name'),
        indexes: async () => (await fixture.server.database.raw('select indexname from pg_indexes where schemaname = current_schema() and tablename = ? order by indexname', [graph.pivotTable])).rows,
      });
      if (!observed.outcome.ok) throw observed.outcome.error;
      assert.strictEqual(observed.returned, undefined);
      assert.strictEqual(observed.calls, 1);
      assert.deepStrictEqual(observed.listenerErrors, []);
      assert.deepStrictEqual(observed.nativeErrors, []);
      assert.deepStrictEqual(observed.ddl, []);
      assert.deepStrictEqual(identifierRead(observed.reads.pivot), links);
      assert.deepStrictEqual(identifierRead(observed.reads.student), [{ id: relationID(student), name: 'owned student' }]);
      assert.deepStrictEqual(identifierRead(observed.reads.indexes), before);
    });
  });

  it('observes reset intentionally removing and recreating its owned catalog names through native CJS', async () => {
    await exercise('cjs', false, async (fixture) => {
      const graph = identifierBoundaryGraph(fixture);
      assert.ok(record(graph.db).connection === record(fixture.db).connection, 'Graph uses the exact acquired SQL handle');
      await completion((done) => call(graph.db, 'ensureSchema', done));
      await completion((done) => call(control(graph.Course, 'db'), 'ensureSchema', done));
      const course = new graph.Course({ title: 'related survivor' });
      await saveRelations(course);
      const student = new graph.Student({ name: 'reset target', courses: [course] });
      await saveRelations(student);
      await fixture.server.database.schema.createTable('identifier_unrelated', (builder) => { builder.integer('id'); });
      await fixture.server.database('identifier_unrelated').insert({ id: 37 });
      const before = records((await fixture.server.database.raw('select indexname from pg_indexes where schemaname = current_schema() and tablename = ? order by indexname', [graph.pivotTable])).rows);
      for (const key of [graph.studentKey, graph.courseKey]) assert.ok(before.some((row) => row.indexname === graph.pivotTable + '_' + key + '_index'));
      const observed = await observeIdentifierControl(graph.db, 'resetSchema', {
        pivot: () => fixture.server.database(graph.pivotTable).select('id', graph.studentKey, graph.courseKey),
        student: () => fixture.server.database(graph.studentTable).select('id', 'name'),
        course: () => fixture.server.database(graph.courseTable).select('id', 'title'),
        unrelated: () => fixture.server.database('identifier_unrelated').select('id'),
        indexes: async () => (await fixture.server.database.raw('select indexname from pg_indexes where schemaname = current_schema() and tablename = ? order by indexname', [graph.pivotTable])).rows,
      });
      if (!observed.outcome.ok) throw observed.outcome.error;
      assert.strictEqual(observed.returned, undefined);
      assert.strictEqual(observed.calls, 1);
      assert.deepStrictEqual(observed.listenerErrors, []);
      assert.deepStrictEqual(observed.nativeErrors, []);
      assert.ok(observed.ddl[0].startsWith('drop table if exists "' + graph.studentTable + '"'));
      assert.ok(observed.ddl[1].startsWith('drop table if exists "' + graph.pivotTable + '"'));
      assert.deepStrictEqual(identifierRead(observed.reads.pivot), []);
      assert.deepStrictEqual(identifierRead(observed.reads.student), []);
      assert.deepStrictEqual(identifierRead(observed.reads.course), [{ id: relationID(course), title: 'related survivor' }]);
      assert.deepStrictEqual(identifierRead(observed.reads.unrelated), [{ id: 37 }]);
      assert.deepStrictEqual(identifierRead(observed.reads.indexes), before);
    });
  });
});

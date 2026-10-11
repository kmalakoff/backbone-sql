import assert from 'assert';

import SQLSchema, { validateDefinitions } from '../../../src/internal/schema.ts';
import type { SQLColumnDefinition } from '../../../src/internal/types.ts';
import { withPostgres } from '../../lib/postgres.ts';
import { createTestConnection, disposeTestConnection } from '../../lib/internalSQLite.ts';

const baseColumns: readonly SQLColumnDefinition[] = [
  { name: 'id', primary: true, type: 'increments' },
  { length: 120, name: 'title', nullable: false, type: 'string', unique: true },
  { indexed: true, name: 'active', nullable: false, type: 'boolean' },
  { name: 'score', precision: 8, scale: 2, type: 'decimal' },
  { name: 'created_at', precision: 3, type: 'dateTime' },
  { name: 'body', textType: 'text', type: 'text' },
  { name: 'metadata', type: 'json' },
  { length: 64, name: 'payload', type: 'binary' },
  { name: 'large_count', type: 'bigInteger' },
  { name: 'ratio', precision: 8, scale: 3, type: 'float' },
  { name: 'published_on', type: 'date' },
  { name: 'recorded_at', precision: 3, type: 'timestamp' },
];

describe('SQLSchema', () => {
  it('preserves direct SQLite BigIncrements primary keys and deferred original options', async () => {
    const fixture = createTestConnection('schema-big-increments', 'big_direct');
    const database = fixture.connection.knex();
    const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
    const reads: string[] = [];
    const getterError = new Error('Direct SQLite BigIncrements losing getter identity');
    let failGetter = false;
    let coercions = 0;
    const ignored = {
      get primaryKey(): never { coercions += 1; throw new Error('Original BigIncrements options must not be forwarded'); },
      toString(): never { coercions += 1; throw new Error('Original BigIncrements options must not be coerced'); },
    };
    const field = { type: 'BigIncrements' };
    for (const key of optionKeys) Object.defineProperty(field, key, { enumerable: true, get(): unknown {
      reads.push(key);
      if (key === 'values' && failGetter) throw getterError;
      return key === 'textType' ? undefined : ignored;
    } });
    try {
      await database.schema.createTable('big_direct_sentinel', (table) => table.text('value'));
      await database('big_direct_sentinel').insert({ value: 'keep' });
      for (const primary of [undefined, true, false]) {
        const label = primary === undefined ? 'default' : primary ? 'yes' : 'no';
        const tableName = `big_direct_${label}`;
        const schema = new SQLSchema(database, tableName);
        const original: SQLColumnDefinition = { name: 'id', type: 'bigIncrements', primary, constructorSource: { kind: 'original-schema', field } };
        const definitions: SQLColumnDefinition[] = [original, { name: 'name', type: 'string' }];
        reads.length = 0;
        failGetter = false;
        validateDefinitions(definitions);
        assert.deepStrictEqual(reads, []);
        await schema.ensureSchema(definitions);
        assert.deepStrictEqual(reads, optionKeys);
        const metadata = await database.raw('PRAGMA table_info(??)', [tableName]);
        assert.deepStrictEqual(metadata.map((row: { name: string; type: string; notnull: number; pk: number }) => [row.name, row.type, row.notnull, row.pk]), [['id', 'INTEGER', 1, 1], ['name', 'varchar(255)', 0, 0]]);
        const ddl = await database('sqlite_schema').where({ name: tableName, type: 'table' }).first('sql');
        assert.ok(typeof ddl.sql === 'string' && /primary key autoincrement/i.test(ddl.sql));
        await database(tableName).insert([{ name: 'first' }, { name: 'second' }]);
        const rows = [{ id: 1, name: 'first' }, { id: 2, name: 'second' }];
        assert.deepStrictEqual(await database(tableName).select('*').orderBy('id'), rows);
        assert.deepStrictEqual(await database('sqlite_sequence').where({ name: tableName }).select('seq'), [{ seq: 2 }]);
        reads.length = 0;
        failGetter = true;
        await schema.ensureSchema(definitions);
        assert.deepStrictEqual(reads, []);
        for (const key of optionKeys) {
          const ambiguous: SQLColumnDefinition = { ...original };
          Object.defineProperty(ambiguous, key, { get(): never { throw new Error('Ambiguous option must not be read'); } });
          assert.throws(() => validateDefinitions([ambiguous]), TypeError);
          assert.throws(() => schema.ensureOwnedSchema([ambiguous], () => { throw new Error('Invalid header must stop before DDL'); }), TypeError);
          await assert.rejects(schema.resetSchema([ambiguous]), TypeError);
          assert.deepStrictEqual(await database(tableName).select('*').orderBy('id'), rows);
        }
        assert.deepStrictEqual(reads, []);
        await assert.rejects(schema.resetSchema(definitions), (error: unknown) => error === getterError);
        assert.deepStrictEqual(reads, optionKeys);
        assert.strictEqual(await schema.hasTable(), false);
        reads.length = 0;
        failGetter = false;
        await schema.ensureSchema(definitions);
        assert.deepStrictEqual(reads, optionKeys);
        await database(tableName).insert({ name: 'recreated' });
        assert.deepStrictEqual(await database(tableName).select('*'), [{ id: 1, name: 'recreated' }]);
        const normalized = new SQLSchema(database, `big_normalized_${label}`);
        await normalized.ensureSchema([{ name: 'id', type: 'bigIncrements', primary }]);
        assert.deepStrictEqual(reads, optionKeys);
        const normalizedMetadata = await database.raw('PRAGMA table_info(??)', [`big_normalized_${label}`]);
        assert.deepStrictEqual(normalizedMetadata.map((row: { type: string; pk: number }) => [row.type, row.pk]), [['INTEGER', 1]]);
      }
      await database.schema.createTable('big_missing', (table) => table.string('name'));
      await database('big_missing').insert({ name: 'existing' });
      reads.length = 0;
      failGetter = true;
      const missing = new SQLSchema(database, 'big_missing');
      await assert.rejects(missing.ensureSchema([{ name: 'name', type: 'string' }, { name: 'id', type: 'bigIncrements', constructorSource: { kind: 'original-schema', field } }]), (error: unknown) => error === getterError);
      assert.deepStrictEqual(reads, optionKeys);
      assert.strictEqual(await missing.hasColumn('id'), false);
      assert.deepStrictEqual(await database('big_missing').select('*'), [{ name: 'existing' }]);
      assert.deepStrictEqual(await database('big_direct_sentinel').select('*'), [{ value: 'keep' }]);
      assert.strictEqual(coercions, 0);
    } finally {
      await disposeTestConnection(fixture);
    }
  });

  it('preserves direct PostgreSQL BigIncrements primary keys and deferred original options', async () => {
    await withPostgres(runtime(), async (server) => {
      const database = server.database;
      const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
      const reads: string[] = [];
      const getterError = new Error('Direct PostgreSQL BigIncrements losing getter identity');
      let failGetter = false;
      let coercions = 0;
      const ignored = {
        get primaryKey(): never { coercions += 1; throw new Error('Original BigIncrements options must not be forwarded'); },
        toString(): never { coercions += 1; throw new Error('Original BigIncrements options must not be coerced'); },
      };
      const field = { type: 'BigIncrements' };
      for (const key of optionKeys) Object.defineProperty(field, key, { enumerable: true, get(): unknown {
        reads.push(key);
        if (key === 'values' && failGetter) throw getterError;
        return key === 'textType' ? undefined : ignored;
      } });
      await database.schema.createTable('big_direct_sentinel', (table) => table.text('value'));
      await database('big_direct_sentinel').insert({ value: 'keep' });
      for (const primary of [undefined, true, false]) {
        const label = primary === undefined ? 'default' : primary ? 'yes' : 'no';
        const tableName = `big_direct_${label}`;
        const schema = new SQLSchema(database, tableName);
        const original: SQLColumnDefinition = { name: 'id', type: 'bigIncrements', primary, constructorSource: { kind: 'original-schema', field } };
        const definitions: SQLColumnDefinition[] = [original, { name: 'name', type: 'string' }];
        reads.length = 0;
        failGetter = false;
        validateDefinitions(definitions);
        assert.deepStrictEqual(reads, []);
        await schema.ensureSchema(definitions);
        assert.deepStrictEqual(reads, optionKeys);
        const metadata = await database('information_schema.columns').where({ table_schema: 'public', table_name: tableName, column_name: 'id' }).select('data_type', 'is_nullable', 'column_default');
        assert.strictEqual(metadata.length, 1);
        assert.strictEqual(metadata[0].data_type, 'bigint');
        assert.strictEqual(metadata[0].is_nullable, 'NO');
        assert.ok(typeof metadata[0].column_default === 'string' && /^nextval\(/.test(metadata[0].column_default));
        const primaryKey = await database.raw('select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = to_regclass(?) and contype = ?', [tableName, 'p']);
        assert.deepStrictEqual(primaryKey.rows, [{ definition: 'PRIMARY KEY (id)' }]);
        const sequence = await database.raw('select pg_get_serial_sequence(?, ?) as sequence_name', [tableName, 'id']);
        assert.deepStrictEqual(sequence.rows, [{ sequence_name: `public.${tableName}_id_seq` }]);
        await database(tableName).insert([{ name: 'first' }, { name: 'second' }]);
        const rows = [{ id: '1', name: 'first' }, { id: '2', name: 'second' }];
        assert.deepStrictEqual(await database(tableName).select('*').orderBy('id'), rows);
        const sequenceState = await database.raw('select last_value::text, is_called from ??', [`${tableName}_id_seq`]);
        assert.deepStrictEqual(sequenceState.rows, [{ last_value: '2', is_called: true }]);
        reads.length = 0;
        failGetter = true;
        await schema.ensureSchema(definitions);
        assert.deepStrictEqual(reads, []);
        for (const key of optionKeys) {
          const ambiguous: SQLColumnDefinition = { ...original };
          Object.defineProperty(ambiguous, key, { get(): never { throw new Error('Ambiguous option must not be read'); } });
          assert.throws(() => validateDefinitions([ambiguous]), TypeError);
          assert.throws(() => schema.ensureOwnedSchema([ambiguous], () => { throw new Error('Invalid header must stop before DDL'); }), TypeError);
          await assert.rejects(schema.resetSchema([ambiguous]), TypeError);
          assert.deepStrictEqual(await database(tableName).select('*').orderBy('id'), rows);
        }
        assert.deepStrictEqual(reads, []);
        await assert.rejects(schema.resetSchema(definitions), (error: unknown) => error === getterError);
        assert.deepStrictEqual(reads, optionKeys);
        assert.strictEqual(await schema.hasTable(), false);
        reads.length = 0;
        failGetter = false;
        await schema.ensureSchema(definitions);
        assert.deepStrictEqual(reads, optionKeys);
        await database(tableName).insert({ name: 'recreated' });
        assert.deepStrictEqual(await database(tableName).select('*'), [{ id: '1', name: 'recreated' }]);
        const normalized = new SQLSchema(database, `big_normalized_${label}`);
        await normalized.ensureSchema([{ name: 'id', type: 'bigIncrements', primary }]);
        assert.deepStrictEqual(reads, optionKeys);
        const normalizedPrimary = await database.raw('select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = to_regclass(?) and contype = ?', [`big_normalized_${label}`, 'p']);
        assert.deepStrictEqual(normalizedPrimary.rows, [{ definition: 'PRIMARY KEY (id)' }]);
      }
      await database.schema.createTable('big_missing', (table) => table.string('name'));
      await database('big_missing').insert({ name: 'existing' });
      const missing = new SQLSchema(database, 'big_missing');
      const definitions: SQLColumnDefinition[] = [{ name: 'name', type: 'string' }, { name: 'id', type: 'bigIncrements', constructorSource: { kind: 'original-schema', field } }];
      reads.length = 0;
      failGetter = true;
      await assert.rejects(missing.ensureSchema(definitions), (error: unknown) => error === getterError);
      assert.deepStrictEqual(reads, optionKeys);
      assert.strictEqual(await missing.hasColumn('id'), false);
      assert.deepStrictEqual(await database('big_missing').select('*'), [{ name: 'existing' }]);
      reads.length = 0;
      failGetter = false;
      await missing.ensureSchema(definitions);
      assert.deepStrictEqual(reads, optionKeys);
      reads.length = 0;
      failGetter = true;
      await missing.ensureSchema(definitions);
      assert.deepStrictEqual(reads, []);
      assert.deepStrictEqual(await database('big_missing').select('*'), [{ name: 'existing', id: '1' }]);
      assert.deepStrictEqual(await database('big_direct_sentinel').select('*'), [{ value: 'keep' }]);
      assert.strictEqual(coercions, 0);
    });
  });

  it('keeps original increment and temporal option reads separate from normalized SQLite definitions', async () => {
    const fixture = createTestConnection('schema-constructors', 'constructor_direct');
    const database = fixture.connection.knex();
    const schema = new SQLSchema(database, 'constructor_direct');
    const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
    const reads: Record<string, string[]> = { id: [], original_date: [] };
    const getterError = new Error('Direct SQLite scalar losing getter identity');
    let failGetter = false;
    let coercions = 0;
    const ignored = { toString(): never { coercions += 1; throw new Error('SQLite scalar arguments must not be coerced'); } };
    const definitions: SQLColumnDefinition[] = [];
    for (const [name, type] of [['id', 'Increments'], ['original_date', 'DateTime']]) {
      const field = { type };
      for (const key of optionKeys) Object.defineProperty(field, key, { enumerable: true, get(): unknown {
        reads[name].push(key);
        if (key === 'values' && failGetter) throw getterError;
        return ignored;
      } });
      definitions.push({ name, type: name === 'id' ? 'increments' : 'dateTime', constructorSource: { kind: 'original-schema', field } });
    }
    definitions.push({ name: 'normalized_stamp', precision: 3, type: 'timestamp' });
    try {
      validateDefinitions(definitions);
      assert.deepStrictEqual(reads, { id: [], original_date: [] });
      await schema.ensureSchema(definitions);
      for (const list of Object.values(reads)) {
        assert.deepStrictEqual(list, optionKeys);
        list.length = 0;
      }
      failGetter = true;
      const input = { original_date: '2026-10-01 12:34:56', normalized_stamp: '2026-10-01 12:34:56' };
      await database('constructor_direct').insert(input);
      const rows = [{ id: 1, ...input }];
      const metadata = await database.raw('PRAGMA table_info(constructor_direct)');
      assert.deepStrictEqual(metadata.map((row: { name: string; type: string; pk: number }) => [row.name, row.type, row.pk]), [
        ['id', 'INTEGER', 1], ['original_date', 'datetime', 0], ['normalized_stamp', 'datetime', 0],
      ]);
      await schema.ensureSchema(definitions);
      assert.deepStrictEqual(reads, { id: [], original_date: [] });
      const original = definitions[1];
      for (const key of optionKeys) {
        const ambiguous: SQLColumnDefinition = { ...original };
        Object.defineProperty(ambiguous, key, { get(): never { throw new Error('Ambiguous normalized option must not be read'); } });
        assert.throws(() => validateDefinitions([ambiguous]), TypeError);
        await assert.rejects(schema.resetSchema([ambiguous]), TypeError);
        assert.deepStrictEqual(await database('constructor_direct').select('*'), rows);
      }
      assert.throws(() => validateDefinitions([{ ...original, type: 'text' }]), TypeError);
      assert.throws(() => validateDefinitions([{ ...original, enumSource: { kind: 'original-schema', field: { type: 'Enum' } } }]), TypeError);
      assert.deepStrictEqual(reads, { id: [], original_date: [] });
      await assert.rejects(schema.ensureSchema([...definitions, { ...original, name: 'missing_date' }]), (error: unknown) => error === getterError);
      assert.deepStrictEqual(reads.original_date, optionKeys);
      assert.deepStrictEqual(reads.id, []);
      assert.strictEqual(await schema.hasColumn('missing_date'), false);
      assert.deepStrictEqual(await database('constructor_direct').select('*'), rows);
      reads.original_date.length = 0;
      failGetter = false;
      await schema.ensureSchema([...definitions, { ...original, name: 'missing_date' }]);
      await schema.ensureSchema([...definitions, { ...original, name: 'missing_date' }]);
      assert.deepStrictEqual(reads.original_date, optionKeys);
      assert.deepStrictEqual(reads.id, []);
      assert.deepStrictEqual(await database('constructor_direct').select('*'), rows.map((row) => ({ ...row, missing_date: null })));
      failGetter = true;
      await assert.rejects(schema.resetSchema(definitions), (error: unknown) => error === getterError);
      assert.strictEqual(await schema.hasTable(), false);
      assert.strictEqual(coercions, 0);
    } finally {
      await disposeTestConnection(fixture);
    }
  });

  it('defers original SQLite enum option reads until missing columns while preserving modifiers', async () => {
    const fixture = createTestConnection('schema-enum', 'enum_entries');
    const database = fixture.connection.knex();
    const schema = new SQLSchema(database, 'enum_entries');
    const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
    const optionReads: string[] = [];
    const getterError = new Error('SQLite original losing getter identity');
    let failGetter = false;
    let coercions = 0;
    const field = { type: 'Enum' };
    const ignoredArgument = { toString(): never { coercions += 1; throw new Error('SQLite enum arguments must not be coerced'); } };
    for (const key of optionKeys) Object.defineProperty(field, key, { enumerable: true, get(): unknown {
      optionReads.push(key);
      if (key === 'values' && failGetter) throw getterError;
      return ignoredArgument;
    } });
    const ignored: SQLColumnDefinition = { name: 'ignored', type: 'enu', enumSource: { kind: 'original-schema', field } };
    const definitions: readonly SQLColumnDefinition[] = [
      { name: 'id', primary: true, type: 'increments' },
      { indexed: true, name: 'state', nullable: false, type: 'enu', unique: true },
      ignored,
    ];
    try {
      validateDefinitions(definitions);
      assert.deepStrictEqual(optionReads, []);
      let calls = 0;
      await new Promise<void>((resolve, reject) => {
        const returned = schema.ensureSchema(definitions, (error) => { calls += 1; if (error) reject(error); else resolve(); });
        assert.strictEqual(returned, undefined);
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(calls, 1);
      assert.deepStrictEqual(optionReads, optionKeys);
      optionReads.length = 0;
      failGetter = true;
      const metadata = await database.raw('PRAGMA table_info(enum_entries)');
      assert.deepStrictEqual(metadata.map((row: { name: string; type: string; notnull: number }) => [row.name, row.type, row.notnull]), [
        ['id', 'INTEGER', 1], ['state', 'varchar', 1], ['ignored', 'varchar', 0],
      ]);
      await database('enum_entries').insert({ state: 'outside-list', ignored: 'anything' });
      const rows = [{ id: 1, state: 'outside-list', ignored: 'anything' }];
      await assert.rejects(database('enum_entries').insert({ state: 'outside-list' }));
      await assert.rejects(database('enum_entries').insert({ state: null }));
      const ambiguous: SQLColumnDefinition = { ...ignored };
      Object.defineProperty(ambiguous, 'values', { get(): never { throw new Error('Ambiguous normalized values must not be read'); } });
      assert.throws(() => validateDefinitions([ambiguous]), TypeError);
      await assert.rejects(schema.resetSchema([ambiguous]), TypeError);
      assert.deepStrictEqual(await database('enum_entries').select('*'), rows);
      assert.deepStrictEqual(optionReads, []);
      await schema.ensureSchema([...definitions, { name: 'extra_enum', nullable: true, type: 'enu' }]);
      await schema.ensureSchema([...definitions, { name: 'extra_enum', nullable: true, type: 'enu' }]);
      assert.deepStrictEqual(await database('enum_entries').select('*'), rows.map((row) => ({ ...row, extra_enum: null })));
      assert.deepStrictEqual(optionReads, []);
      await assert.rejects(schema.ensureSchema([...definitions, { ...ignored, name: 'missing_enum' }]), (error: unknown) => error === getterError);
      assert.deepStrictEqual(optionReads, optionKeys);
      assert.strictEqual(await schema.hasColumn('missing_enum'), false);
      assert.deepStrictEqual(await database('enum_entries').select('*'), rows.map((row) => ({ ...row, extra_enum: null })));
      assert.strictEqual(coercions, 0);
    } finally {
      await disposeTestConnection(fixture);
    }
  });

  it('creates, updates, resets, renames, and drops a real SQLite schema', async () => {
    const fixture = createTestConnection('schema', 'entries');
    const schema = new SQLSchema(fixture.connection.knex(), 'entries');

    try {
      await new Promise<void>((resolve, reject) => {
        const result = schema.hasTable((error, exists) => {
          if (error) reject(error);
          else {
            assert.strictEqual(exists, false);
            resolve();
          }
        });
        assert.strictEqual(result, undefined);
      });

      await new Promise<void>((resolve, reject) => {
        const result = schema.ensureSchema(baseColumns, (error) => {
          if (error) reject(error);
          else resolve();
        });
        assert.strictEqual(result, undefined);
      });

      assert.strictEqual(await schema.hasTable(), true);
      assert.strictEqual(await schema.hasColumn('title'), true);
      assert.strictEqual(await schema.hasColumn('summary'), false);

      await schema.ensureSchema([...baseColumns, { name: 'summary', nullable: true, type: 'text' }]);
      assert.strictEqual(await schema.hasColumn('summary'), true);

      await fixture.connection.knex()('entries').insert({ active: true, title: 'before reset' });
      assert.deepStrictEqual(await fixture.connection.knex()('entries').count({ count: '*' }).first(), { count: 1 });

      await schema.resetSchema(baseColumns);
      assert.strictEqual(await schema.hasTable(), true);
      assert.deepStrictEqual(await fixture.connection.knex()('entries').select('*'), []);

      await new Promise<void>((resolve, reject) => {
        const result = schema.renameTable('archived_entries', (error) => {
          if (error) reject(error);
          else resolve();
        });
        assert.strictEqual(result, undefined);
      });

      assert.strictEqual(await schema.hasTable(), false);
      const renamed = new SQLSchema(fixture.connection.knex(), 'archived_entries');
      assert.strictEqual(await renamed.hasTable(), true);
      await renamed.dropTable();
      assert.strictEqual(await renamed.hasTable(), false);
      await renamed.dropTableIfExists();
    } finally {
      await disposeTestConnection(fixture);
    }
  });

  it('rejects unsafe and duplicate schema identifiers before execution', async () => {
    const fixture = createTestConnection('schema-identifiers', 'entries');
    const schema = new SQLSchema(fixture.connection.knex(), 'entries');

    try {
      assert.throws(() => new SQLSchema(fixture.connection.knex(), 'entries; drop table entries'), /Table name is invalid/);
      await assert.rejects(schema.ensureSchema([{ name: 'bad name', type: 'text' }]), /Column name is invalid/);
      await assert.rejects(
        schema.ensureSchema([
          { name: 'same', type: 'text' },
          { name: 'same', type: 'integer' },
        ]),
        /Duplicate column definition/
      );
    } finally {
      await disposeTestConnection(fixture);
    }
  });
});

describe('SQLSchema PostgreSQL identifier boundaries', () => {
  function runtime(): string {
    const value = process.env.TEST_POSTGRES_RUNTIME;
    if (!value) throw new Error('Local SQL PostgreSQL trial requires approved TEST_POSTGRES_RUNTIME; no global service fallback');
    return value;
  }

  it('preserves normalized PostgreSQL temporal precision separately from original constructor selection', async () => {
    await withPostgres(runtime(), async (server) => {
      const schema = new SQLSchema(server.database, 'constructor_direct');
      const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
      const reads: string[] = [];
      const getterError = new Error('Direct PostgreSQL scalar losing getter identity');
      let failGetter = false;
      const field = { type: 'DateTime' };
      for (const key of optionKeys) Object.defineProperty(field, key, { enumerable: true, get(): unknown {
        reads.push(key);
        if (key === 'values' && failGetter) throw getterError;
        return key === 'textType' ? undefined : true;
      } });
      const original: SQLColumnDefinition = { name: 'original_date', type: 'dateTime', constructorSource: { kind: 'original-schema', field } };
      const definitions: readonly SQLColumnDefinition[] = [
        { name: 'id', type: 'increments' },
        original,
        { name: 'original_stamp', type: 'timestamp', constructorSource: { kind: 'original-schema', field: { type: 'Timestamp', precision: 3, value: false } } },
        { name: 'normalized_date', type: 'dateTime', precision: 3 },
        { name: 'normalized_stamp', type: 'timestamp', precision: 3 },
      ];
      validateDefinitions(definitions);
      assert.deepStrictEqual(reads, []);
      await schema.ensureSchema(definitions);
      assert.deepStrictEqual(reads, optionKeys);
      reads.length = 0;
      failGetter = true;
      const metadata = await server.database('information_schema.columns').where({ table_schema: 'public', table_name: 'constructor_direct' })
        .select('column_name', 'data_type', 'datetime_precision').orderBy('column_name');
      assert.deepStrictEqual(metadata, [
        { column_name: 'id', data_type: 'integer', datetime_precision: null },
        { column_name: 'normalized_date', data_type: 'timestamp with time zone', datetime_precision: 3 },
        { column_name: 'normalized_stamp', data_type: 'timestamp with time zone', datetime_precision: 3 },
        { column_name: 'original_date', data_type: 'timestamp with time zone', datetime_precision: 6 },
        { column_name: 'original_stamp', data_type: 'timestamp without time zone', datetime_precision: 6 },
      ]);
      await server.database('constructor_direct').insert({ original_date: '2026-10-01T12:34:56.789123+03:00', original_stamp: '2026-10-01T12:34:56.789123+03:00', normalized_date: '2026-10-01T12:34:56.789123+03:00', normalized_stamp: '2026-10-01T12:34:56.789123+03:00' });
      const native = await server.database.raw("select to_char(original_date AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as original_date, to_char(original_stamp, 'YYYY-MM-DD HH24:MI:SS.US') as original_stamp, to_char(normalized_date AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as normalized_date, to_char(normalized_stamp AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as normalized_stamp from constructor_direct");
      assert.deepStrictEqual(native.rows, [{ original_date: '2026-10-01 09:34:56.789123', original_stamp: '2026-10-01 12:34:56.789123', normalized_date: '2026-10-01 09:34:56.789000', normalized_stamp: '2026-10-01 09:34:56.789000' }]);
      const rows = await server.database('constructor_direct').select('*');
      await schema.ensureSchema(definitions);
      assert.deepStrictEqual(reads, []);
      const ambiguous: SQLColumnDefinition = { ...original };
      Object.defineProperty(ambiguous, 'precision', { get(): never { throw new Error('Ambiguous normalized precision must not be read'); } });
      assert.throws(() => validateDefinitions([ambiguous]), TypeError);
      let beforeDDL = 0;
      assert.throws(() => schema.ensureOwnedSchema([ambiguous], () => { beforeDDL += 1; }), TypeError);
      assert.strictEqual(beforeDDL, 0);
      await assert.rejects(schema.resetSchema([ambiguous]), TypeError);
      assert.deepStrictEqual(await server.database('constructor_direct').select('*'), rows);
      assert.deepStrictEqual(reads, []);
      await assert.rejects(schema.ensureSchema([...definitions, { ...original, name: 'missing_date' }]), (error: unknown) => error === getterError);
      assert.deepStrictEqual(reads, optionKeys);
      assert.strictEqual(await schema.hasColumn('missing_date'), false);
      assert.deepStrictEqual(await server.database('constructor_direct').select('*'), rows);
      reads.length = 0;
      await assert.rejects(schema.resetSchema(definitions), (error: unknown) => error === getterError);
      assert.deepStrictEqual(reads, optionKeys);
      assert.strictEqual(await schema.hasTable(), false);
    });
  });

  it('normalizes an empty PostgreSQL enum and rejects malformed direct definitions before DDL', async () => {
    await withPostgres(runtime(), async (server) => {
      const schema = new SQLSchema(server.database, 'enum_direct');
      const definitions: readonly SQLColumnDefinition[] = [
        { name: 'id', type: 'increments' },
        { name: 'state', nullable: true, type: 'enu', values: [] },
      ];
      await schema.ensureSchema(definitions);
      await server.database('enum_direct').insert([{ id: 11, state: '' }, { id: 12, state: null }]);
      const rows = [{ id: 11, state: '' }, { id: 12, state: null }];
      const columns = await server.database('information_schema.columns').where({ table_schema: 'public', table_name: 'enum_direct', column_name: 'state' }).select('data_type');
      assert.deepStrictEqual(columns, [{ data_type: 'text' }]);
      await assert.rejects(server.database('enum_direct').insert({ id: 13, state: 'unlisted' }), (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === '23514');
      const checks = await server.database.raw('select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = to_regclass(?) and contype = ?', ['enum_direct', 'c']);
      assert.strictEqual(checks.rows.length, 1);
      for (const invalid of [undefined, null, 'scalar', [1], ['ready', undefined], new Array(1)]) {
        const malformed: SQLColumnDefinition = { name: 'state', type: 'enu' };
        Reflect.set(malformed, 'values', invalid);
        await assert.rejects(schema.ensureSchema([malformed]), TypeError);
        let beforeDDL = 0;
        assert.throws(() => schema.ensureOwnedSchema([malformed], () => { beforeDDL += 1; }), TypeError);
        assert.strictEqual(beforeDDL, 0);
        let calls = 0;
        await assert.rejects(new Promise<void>((resolve, reject) => {
          const returned = schema.resetSchema([malformed], (error) => { calls += 1; if (error) reject(error); else resolve(); });
          assert.strictEqual(returned, undefined);
        }), TypeError);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(calls, 1);
        assert.deepStrictEqual(await server.database('enum_direct').select('*').orderBy('id'), rows);
        const after = await server.database.raw('select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = to_regclass(?) and contype = ?', ['enum_direct', 'c']);
        assert.deepStrictEqual(after.rows, checks.rows);
      }
      const originalError = new Error('Normalized enum getter identity');
      const throwing: SQLColumnDefinition = { name: 'state', type: 'enu' };
      Object.defineProperty(throwing, 'values', { get(): never { throw originalError; } });
      await assert.rejects(schema.resetSchema([throwing]), (error: unknown) => error === originalError);
      assert.deepStrictEqual(await server.database('enum_direct').select('*').orderBy('id'), rows);
      const optionKeys = ['textType', 'length', 'precision', 'scale', 'value', 'values'];
      const optionReads: string[] = [];
      const getterError = new Error('PostgreSQL original losing getter identity');
      let failGetter = false;
      const field = { type: 'Enum' };
      for (const key of optionKeys) Object.defineProperty(field, key, { enumerable: true, get(): string[] {
        optionReads.push(key);
        if (key === 'values' && failGetter) throw getterError;
        return [key === 'textType' ? 'first-option' : 'losing-option'];
      } });
      const source: SQLColumnDefinition = { name: 'state', type: 'enu', enumSource: { kind: 'original-schema', field } };
      validateDefinitions([source]);
      assert.deepStrictEqual(optionReads, []);
      const ambiguous: SQLColumnDefinition = { ...source, values: undefined };
      assert.throws(() => validateDefinitions([ambiguous]), TypeError);
      await assert.rejects(schema.resetSchema([ambiguous]), TypeError);
      assert.deepStrictEqual(await server.database('enum_direct').select('*').orderBy('id'), rows);
      assert.deepStrictEqual(optionReads, []);
      const originalSchema = new SQLSchema(server.database, 'enum_source_direct');
      await originalSchema.ensureSchema([source]);
      assert.deepStrictEqual(optionReads, optionKeys);
      await server.database('enum_source_direct').insert({ state: 'first-option' });
      optionReads.length = 0;
      failGetter = true;
      await originalSchema.ensureSchema([source]);
      assert.deepStrictEqual(optionReads, []);
      await assert.rejects(originalSchema.ensureSchema([source, { ...source, name: 'missing_enum' }]), (error: unknown) => error === getterError);
      assert.deepStrictEqual(optionReads, optionKeys);
      assert.deepStrictEqual(await server.database('enum_source_direct').select('*'), [{ state: 'first-option' }]);
      optionReads.length = 0;
      await assert.rejects(originalSchema.resetSchema([source]), (error: unknown) => error === getterError);
      assert.deepStrictEqual(optionReads, optionKeys);
      assert.strictEqual(await originalSchema.hasTable(), false);
      assert.deepStrictEqual(await server.database('enum_direct').select('*').orderBy('id'), rows);
    });
  });

  it('preserves exact 63-byte ASCII table and column identities without automatic indexes', async () => {
    await withPostgres(runtime(), async (server) => {
      const name = 't'.repeat(63);
      const column = 'c'.repeat(63);
      assert.strictEqual(Buffer.byteLength(name), 63);
      assert.strictEqual(Buffer.byteLength(column), 63);
      const schema = new SQLSchema(server.database, name);
      await schema.ensureSchema([{ name: column, type: 'integer' }]);
      await server.database(name).insert({ [column]: 37 });
      assert.deepStrictEqual(await server.database(name).select(column), [{ [column]: 37 }]);
      assert.strictEqual(await schema.hasColumn(column), true);
    });
  });

  it('preserves exact 63-byte automatically generated index, unique and primary names', async () => {
    await withPostgres(runtime(), async (server) => {
      const indexed = 'c'.repeat(55);
      const unique = 'c'.repeat(54);
      const primaryTable = 'p'.repeat(58);
      const specs: Array<{ table: string; definition: SQLColumnDefinition; expected: string }> = [
        { table: 'i', definition: { name: indexed, type: 'integer', indexed: true }, expected: 'i_' + indexed + '_index' },
        { table: 'u', definition: { name: unique, type: 'integer', unique: true }, expected: 'u_' + unique + '_unique' },
        { table: primaryTable, definition: { name: 'id', type: 'integer', primary: true }, expected: primaryTable + '_pkey' },
      ];
      for (const spec of specs) {
        assert.strictEqual(Buffer.byteLength(spec.expected), 63);
        await new SQLSchema(server.database, spec.table).ensureSchema([spec.definition]);
        const indexes = await server.database.raw('select indexname from pg_indexes where schemaname = current_schema() and tablename = ?', [spec.table]);
        assert.ok(indexes.rows.some((row: { indexname: string }) => row.indexname === spec.expected));
        if (spec.definition.primary || spec.definition.unique) {
          const constraints = await server.database.raw('select conname from pg_constraint where conrelid = to_regclass(?)', [spec.table]);
          assert.ok(constraints.rows.some((row: { conname: string }) => row.conname === spec.expected));
        }
      }
    });
  });
});

type NameOutcome = { ok: true; value: unknown } | { ok: false; error: unknown };

async function captureNameOutcome(operation: () => Promise<unknown>): Promise<NameOutcome> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error };
  }
}

function nameOutcomeSummary(outcome: NameOutcome): unknown {
  if (outcome.ok) return outcome;
  const error = outcome.error;
  return { ok: false, error: error instanceof Error ? { name: error.name, message: error.message, code: Reflect.get(error, 'code') } : { type: typeof error } };
}

async function observeSchemaNames(
  database: Parameters<Parameters<typeof withPostgres>[1]>[0]['database'],
  operation: () => Promise<unknown>,
  inspections: Record<string, () => Promise<unknown>>
) {
  const ddl: string[] = [];
  const nativeErrors: Array<{ error: Error; sql: string }> = [];
  const track = (query: { sql: string }): void => {
    if (/^(create|alter|drop)\s/i.test(query.sql)) ddl.push(query.sql);
  };
  const failed = (error: Error, query: { sql: string }): void => { nativeErrors.push({ error, sql: query.sql }); };
  database.on('query', track);
  database.on('query-error', failed);
  const outcome = await captureNameOutcome(operation);
  const listenerErrors: unknown[] = [];
  for (const [event, listener] of [['query', track], ['query-error', failed]] as const) {
    try { database.removeListener(event, listener); } catch (error) { listenerErrors.push(error); }
  }
  const reads: Record<string, NameOutcome> = {};
  for (const [name, inspect] of Object.entries(inspections)) reads[name] = await captureNameOutcome(inspect);
  process.stdout.write(`SQL_IDENTIFIER_OBSERVATION ${JSON.stringify({
    operation: nameOutcomeSummary(outcome), ddl,
    nativeErrors: nativeErrors.map(({ error, sql }) => ({ sql, outcome: nameOutcomeSummary({ ok: false, error }) })),
    reads: Object.fromEntries(Object.entries(reads).map(([name, read]) => [name, nameOutcomeSummary(read)])),
    listenerErrors: listenerErrors.map((error) => nameOutcomeSummary({ ok: false, error })),
  })}\n`);
  return { outcome, ddl, nativeErrors, reads, listenerErrors };
}

function nameRead(read: NameOutcome): unknown {
  if (!read.ok) throw read.error;
  return read.value;
}

describe('SQLSchema PostgreSQL identifier observations', () => {
  function runtime(): string {
    const value = process.env.TEST_POSTGRES_RUNTIME;
    if (!value) throw new Error('Local SQL PostgreSQL trial requires approved TEST_POSTGRES_RUNTIME; no global service fallback');
    return value;
  }

  it('observes ensure planning a missing indexed Integer with a 64-byte generated name', async () => {
    await withPostgres(runtime(), async (server) => {
      const table = 'i';
      const column = 'c'.repeat(56);
      const index = table + '_' + column + '_index';
      assert.strictEqual(Buffer.byteLength(index), 64);
      await server.database.schema.createTable(table, (builder) => { builder.integer('id'); builder.string('marker'); });
      await server.database(table).insert({ id: 7, marker: 'survivor' });
      const schema = new SQLSchema(server.database, table);
      assert.strictEqual(await schema.hasColumn(column), false);
      const observed = await observeSchemaNames(server.database, () => schema.ensureSchema([{ name: column, type: 'integer', indexed: true }]), {
        rows: () => server.database(table).select('id', 'marker', column),
        indexes: async () => (await server.database.raw('select indexname from pg_indexes where schemaname = current_schema() and tablename = ?', [table])).rows,
      });
      if (!observed.outcome.ok) throw observed.outcome.error;
      assert.deepStrictEqual(observed.listenerErrors, []);
      assert.deepStrictEqual(observed.nativeErrors, []);
      assert.ok(observed.ddl.some((sql) => sql.startsWith('alter table') && sql.includes('"' + column + '"')));
      assert.ok(observed.ddl.some((sql) => sql.startsWith('create index "' + index + '"')));
      assert.deepStrictEqual(nameRead(observed.reads.rows), [{ id: 7, marker: 'survivor', [column]: null }]);
      assert.deepStrictEqual(nameRead(observed.reads.indexes), [{ indexname: index.slice(0, 63) }]);
    });
  });

  it('observes callback reset case-fold collision using short distinct legal columns', async () => {
    await withPostgres(runtime(), async (server) => {
      const table = 'case_guard';
      const columns = ['linkA', 'linka'];
      const names = columns.map((column) => (table + '_' + column + '_index').toLowerCase());
      assert.strictEqual(names[0], names[1]);
      for (const name of [table, ...columns, ...names]) assert.ok(Buffer.byteLength(name) < 63);
      await server.database.schema.createTable(table, (builder) => { builder.integer('id'); builder.string('marker'); for (const column of columns) builder.integer(column); });
      await server.database(table).insert({ id: 9, marker: 'target before reset', linkA: 11, linka: 22 });
      await server.database.schema.createTable('unrelated_guard', (builder) => { builder.integer('id'); });
      await server.database('unrelated_guard').insert({ id: 37 });
      const schema = new SQLSchema(server.database, table);
      let returned: unknown;
      let calls = 0;
      const observed = await observeSchemaNames(server.database, () => new Promise<void>((resolve, reject) => {
        returned = schema.resetSchema([{ name: 'id', type: 'integer' }, { name: 'marker', type: 'string' }, ...columns.map((name): SQLColumnDefinition => ({ name, type: 'integer', indexed: true }))], (error) => {
          calls += 1;
          if (error !== null && error !== undefined) reject(error); else resolve();
        });
      }), {
        target: () => server.database(table).select('id', 'marker', ...columns),
        unrelated: () => server.database('unrelated_guard').select('id'),
        indexes: async () => (await server.database.raw('select indexname from pg_indexes where schemaname = current_schema() and tablename = ?', [table])).rows,
      });
      assert.strictEqual(returned, undefined);
      assert.strictEqual(calls, 1);
      assert.deepStrictEqual(observed.listenerErrors, []);
      if (observed.outcome.ok) assert.fail('Source-derived case-fold collision must be measured, not replaced by a rejection-policy assertion');
      const error = observed.outcome.error;
      assert.ok(error instanceof Error);
      if (Reflect.get(error, 'code') !== '42P07') throw error;
      assert.ok(observed.nativeErrors.some((failure) => failure.error === error), 'Callback preserves the exact native operation Error');
      assert.ok(observed.nativeErrors.some((failure) => failure.error === error && failure.sql.startsWith('create index')));
      assert.ok(observed.ddl[0].startsWith('drop table'));
      assert.deepStrictEqual(nameRead(observed.reads.target), []);
      assert.deepStrictEqual(nameRead(observed.reads.unrelated), [{ id: 37 }]);
      assert.deepStrictEqual(nameRead(observed.reads.indexes), [{ indexname: names[0] }]);
    });
  });
});

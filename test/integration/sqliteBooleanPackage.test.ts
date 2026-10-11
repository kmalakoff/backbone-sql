import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'assert';
import type Backbone from 'backbone';
import BackboneSQL from 'backbone-sql';
import { safeRmSync } from 'fs-remove-compat';

type Callback = (error: Error | null, value?: unknown) => void;

function call(host: object, method: string, arguments_: readonly unknown[]): unknown {
  const operation: unknown = Reflect.get(host, method);
  if (typeof operation !== 'function') throw new Error(`Missing public operation: ${method}`);
  return Reflect.apply(operation, host, arguments_);
}

function callbackResult(invoke: (callback: Callback) => unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    invoke((error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function cursorResult(model: object, query: Record<string, unknown>, method = 'toJSON'): Promise<unknown> {
  const cursor = call(model, 'cursor', [query]);
  if (typeof cursor !== 'object' || cursor === null) throw new Error('Public cursor was not returned');
  return callbackResult((callback) => {
    const returned = call(cursor, method, [callback]);
    assert.strictEqual(returned, undefined);
  });
}

function row(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a database row');
  return Object.fromEntries(Object.entries(value));
}

function rows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('Expected database rows');
  return value.map(row);
}

function model(value: unknown): Backbone.Model {
  if (!(value instanceof BackboneSQL.Backbone.Model)) throw new Error('Expected a public Backbone model');
  return value;
}

describe('public package SQLite native Boolean conversion', () => {
  for (const cacheEnabled of [false, true]) {
    it(`converts schema Booleans across model, collection, cursor, and relation reads with cache ${cacheEnabled ? 'on' : 'off'}`, async () => {
      const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp/public-sql-boolean-tests', randomUUID());
      const filename = path.join(root, 'database.sqlite3');
      mkdirSync(root, { recursive: true });

      class BooleanParent extends BackboneSQL.Backbone.Model {
        urlRoot = 'sqlite3:///boolean_parents';

        schema(): Record<string, unknown> {
          return {
            active: ['Boolean', { nullable: true }],
            children: () => ['hasMany', BooleanChild, { as: 'parent' }],
            name: ['String', { nullable: false }],
            numeric: ['Integer', { nullable: true }],
            profile: () => ['hasOne', BooleanProfile, { as: 'owner' }],
            tags: () => ['hasMany', BooleanTag, { as: 'parents' }],
          };
        }
      }

      class BooleanChild extends BackboneSQL.Backbone.Model {
        urlRoot = 'sqlite3:///boolean_children';

        schema(): Record<string, unknown> {
          return {
            active: ['Boolean', { nullable: true }],
            numeric: ['Integer', { nullable: true }],
            parent: () => ['belongsTo', BooleanParent, { as: 'children' }],
            verified: ['Boolean', { nullable: true }],
          };
        }
      }

      class BooleanProfile extends BackboneSQL.Backbone.Model {
        urlRoot = 'sqlite3:///boolean_profiles';

        schema(): Record<string, unknown> {
          return {
            active: ['Boolean', { nullable: true }],
            confirmed: ['Boolean', { nullable: true }],
            owner: () => ['belongsTo', BooleanParent, { as: 'profile' }],
          };
        }
      }

      class BooleanTag extends BackboneSQL.Backbone.Model {
        urlRoot = 'sqlite3:///boolean_tags';

        schema(): Record<string, unknown> {
          return {
            active: ['Boolean', { nullable: true }],
            parents: () => ['hasMany', BooleanParent, { as: 'tags' }],
            tagged: ['Boolean', { nullable: true }],
          };
        }
      }

      class BooleanParents extends BackboneSQL.Backbone.Collection<BooleanParent> {}

      BackboneSQL.configure({ model_cache: { enabled: cacheEnabled, max: 100 } });
      BooleanParent.prototype.sync = BackboneSQL.sync(BooleanParent, { filename });
      BooleanParents.prototype.model = BooleanParent;
      BooleanParents.prototype.sync = BackboneSQL.sync(BooleanParents);
      try {
        for (const type of [BooleanParent, BooleanChild, BooleanProfile, BooleanTag]) {
          await callbackResult((callback) => call(type, 'resetSchema', [{}, callback]));
        }

        const parents = [new BooleanParent({ active: true, name: 'a', numeric: 1 }), new BooleanParent({ active: false, name: 'b', numeric: 0 }), new BooleanParent({ active: null, name: 'c', numeric: null })];
        const expected = [true, false, null];
        for (const [index, parent] of parents.entries()) {
          await parent.save();
          assert.strictEqual(parent.get('active'), expected[index]);
          const fetched = new BooleanParent({ id: parent.id });
          await fetched.fetch();
          assert.strictEqual(fetched.get('active'), expected[index]);
          assert.strictEqual(fetched.get('numeric'), index === 0 ? 1 : index === 1 ? 0 : null);
          const found = model(await callbackResult((callback) => call(BooleanParent, 'findOne', [{ id: parent.id }, callback])));
          assert.strictEqual(found.get('active'), expected[index]);
          if (cacheEnabled) assert.strictEqual(found, parent);
        }

        const database = row(call(BooleanParent, 'db', []));
        const query = database.query;
        if (typeof query !== 'object' || query === null) throw new Error('Public database query was not returned');
        assert.deepStrictEqual(rows(await call(query, 'select', [{ columns: ['active', 'numeric'], sort: 'name' }])), [
          { active: 1, numeric: 1 },
          { active: 0, numeric: 0 },
          { active: null, numeric: null },
        ]);

        const collection = new BooleanParents();
        await collection.fetch();
        assert.deepStrictEqual(collection.pluck('active'), expected);
        assert.deepStrictEqual(collection.pluck('numeric'), [1, 0, null]);
        const found = await callbackResult((callback) => call(BooleanParent, 'find', [{ $sort: 'name' }, callback]));
        if (!Array.isArray(found)) throw new Error('Public find did not return models');
        assert.deepStrictEqual(
          found.map((value) => model(value).get('active')),
          expected
        );

        assert.deepStrictEqual(
          rows(await cursorResult(BooleanParent, { $sort: 'name' })).map((value) => value.active),
          expected
        );
        assert.deepStrictEqual(await cursorResult(BooleanParent, { $select: ['active', 'numeric'], $sort: 'name' }), [
          { active: true, numeric: 1 },
          { active: false, numeric: 0 },
          { active: null, numeric: null },
        ]);
        assert.deepStrictEqual(await cursorResult(BooleanParent, { $sort: 'name', $values: ['active'] }), expected);
        assert.deepStrictEqual(await cursorResult(BooleanParent, { $sort: 'name', $values: ['active', 'numeric'] }), [
          [true, 1],
          [false, 0],
          [null, null],
        ]);
        assert.strictEqual(await cursorResult(BooleanParent, { $one: true, $values: ['active'], name: 'b' }), false);
        assert.strictEqual(await cursorResult(BooleanParent, { $one: true, $values: ['active'], name: 'c' }), null);
        assert.deepStrictEqual(await cursorResult(BooleanParent, { $limit: 1, $offset: 1, $page: true, $sort: 'name', $values: ['active'] }), {
          offset: 1,
          rows: [false],
          total_rows: 3,
        });

        const children = expected.map((active, index) => new BooleanChild({ active, numeric: index === 0 ? 1 : index === 1 ? 0 : null, parent: parents[0], verified: active }));
        for (const child of children) await callbackResult((callback) => call(child, 'save', [callback]));
        for (const [index, active] of expected.entries()) {
          const profile = new BooleanProfile({ active, confirmed: active, owner: parents[index] });
          await callbackResult((callback) => call(profile, 'save', [callback]));
          const tag = new BooleanTag({ active, tagged: active });
          await callbackResult((callback) => call(tag, 'save', [callback]));
          await callbackResult((callback) => call(parents[0], 'patchAdd', ['tags', tag, callback]));
        }

        const included = rows(await cursorResult(BooleanParent, { $include: ['children', 'profile', 'tags'], $sort: 'name' }));
        assert.deepStrictEqual(
          included.map((value) => value.active),
          expected
        );
        assert.deepStrictEqual(
          included.map((value) => row(value.profile).active),
          expected
        );
        assert.deepStrictEqual(
          included.map((value) => row(value.profile).confirmed),
          expected
        );
        assert.deepStrictEqual(
          rows(included[0]?.children).map((value) => value.active),
          expected
        );
        assert.deepStrictEqual(
          rows(included[0]?.children).map((value) => value.verified),
          expected
        );
        assert.deepStrictEqual(
          rows(included[0]?.children).map((value) => value.numeric),
          [1, 0, null]
        );
        assert.deepStrictEqual(
          rows(included[0]?.tags).map((value) => value.active),
          expected
        );
        assert.deepStrictEqual(
          rows(included[0]?.tags).map((value) => value.tagged),
          expected
        );
        assert.deepStrictEqual(included[1]?.children, []);
        assert.deepStrictEqual(included[1]?.tags, []);
        const reverseIncluded = rows(await cursorResult(BooleanProfile, { $include: ['owner'], $sort: 'id' }));
        assert.deepStrictEqual(
          reverseIncluded.map((value) => row(value.owner).active),
          expected
        );
        assert.deepStrictEqual(await cursorResult(BooleanParent, { $include: ['children', 'profile', 'tags'], $sort: 'name', $values: ['active'] }), expected);
        const selected = rows(await cursorResult(BooleanParent, { $include: ['children'], $select: ['active'], $sort: 'name' }));
        assert.deepStrictEqual(
          selected.map((value) => Object.keys(value).sort()),
          [
            ['active', 'children'],
            ['active', 'children'],
            ['active', 'children'],
          ]
        );
        assert.deepStrictEqual(
          selected.map((value) => value.active),
          expected
        );
        assert.deepStrictEqual(
          rows(selected[0]?.children).map((value) => value.active),
          expected
        );

        const includedModel = model(await cursorResult(BooleanParent, { $include: ['children'], $one: true, id: parents[0]?.id }, 'toModels'));
        const includedChildren = await callbackResult((callback) => call(includedModel, 'get', ['children', callback]));
        if (!Array.isArray(includedChildren)) throw new Error('Included model children were not returned');
        assert.deepStrictEqual(
          includedChildren.map((value) => model(value).get('active')),
          expected
        );
        assert.deepStrictEqual(
          includedChildren.map((value) => model(value).get('verified')),
          expected
        );
        if (cacheEnabled) {
          assert.strictEqual(includedModel, parents[0]);
          assert.strictEqual(includedChildren[0], children[0]);
        }

        const first = parents[0];
        if (!first) throw new Error('Missing Boolean parent fixture');
        await first.save({ active: false });
        assert.strictEqual(first.get('active'), false);
        await call(query, 'update', [{ id: first.id }, { active: 1 }]);
        const refreshed = model(await callbackResult((callback) => call(BooleanParent, 'findOne', [{ id: first.id }, callback])));
        assert.strictEqual(refreshed.get('active'), true);
        if (cacheEnabled) assert.strictEqual(refreshed, first);
        const fetched = new BooleanParent({ id: first.id });
        await fetched.fetch();
        assert.strictEqual(fetched.get('active'), true);
      } finally {
        try {
          const sync = BooleanParent.prototype.sync;
          await Reflect.apply(sync, BooleanParent.prototype, ['closeConnection']);
        } finally {
          BackboneSQL.configure({ model_cache: { enabled: false } });
          safeRmSync(root);
        }
      }
    });
  }
});

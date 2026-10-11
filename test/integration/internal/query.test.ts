import assert from 'assert';

import SQLQuery from '../../../src/internal/query.ts';
import SQLSchema from '../../../src/internal/schema.ts';
import type { SQLColumnDefinition } from '../../../src/internal/types.ts';
import { createTestConnection, disposeTestConnection } from '../../lib/internalSQLite.ts';

const authorColumns: readonly SQLColumnDefinition[] = [
  { name: 'id', primary: true, type: 'increments' },
  { name: 'name', nullable: false, type: 'string' },
];

const bookColumns: readonly SQLColumnDefinition[] = [
  { name: 'id', primary: true, type: 'increments' },
  { indexed: true, name: 'author_id', nullable: false, type: 'integer' },
  { name: 'title', nullable: false, type: 'string' },
  { name: 'score', nullable: false, type: 'integer' },
  { name: 'active', nullable: false, type: 'boolean' },
  { name: 'note', nullable: true, type: 'text' },
];

const authorshipColumns: readonly SQLColumnDefinition[] = [
  { name: 'id', primary: true, type: 'increments' },
  { indexed: true, name: 'author_id', nullable: false, type: 'integer' },
  { indexed: true, name: 'book_id', nullable: false, type: 'integer' },
];

describe('SQLQuery', () => {
  it('maps legacy reads and writes to supported Knex operations on real SQLite', async () => {
    const fixture = createTestConnection('query', 'books');
    const database = fixture.connection.knex();
    const authorSchema = new SQLSchema(database, 'authors');
    const bookSchema = new SQLSchema(database, 'books');
    const authorshipSchema = new SQLSchema(database, 'authorships');
    const authors = new SQLQuery(database, 'authors');
    const books = new SQLQuery(database, 'books');
    const authorships = new SQLQuery(database, 'authorships');

    try {
      await authorSchema.ensureSchema(authorColumns);
      await bookSchema.ensureSchema(bookColumns);
      await authorshipSchema.ensureSchema(authorshipColumns);

      const adaID = await new Promise<string | number>((resolve, reject) => {
        const result = authors.insert({ name: 'Ada' }, 'id', (error, id) => {
          if (error) reject(error);
          else if (id === undefined) reject(new Error('Missing inserted identifier'));
          else resolve(id);
        });
        assert.strictEqual(result, undefined);
      });
      const graceID = await authors.insert({ name: 'Grace' });
      assert.strictEqual(adaID, 1);
      assert.strictEqual(graceID, 2);

      const firstID = await books.insert({ active: true, author_id: adaID, note: null, score: 10, title: 'A' });
      const secondID = await books.insert({ active: true, author_id: adaID, note: 'x', score: 20, title: 'B' });
      const thirdID = await books.insert({ active: false, author_id: graceID, note: null, score: 15, title: 'C' });
      const fourthID = await books.insert({ active: false, author_id: graceID, note: 'y', score: 5, title: 'D' });
      assert.deepStrictEqual([firstID, secondID, fourthID], [1, 2, 4]);
      await authorships.insert({ author_id: adaID, book_id: firstID });
      await authorships.insert({ author_id: adaID, book_id: secondID });
      await authorships.insert({ author_id: graceID, book_id: thirdID });

      assert.deepStrictEqual(await books.select({ columns: ['title'], sort: 'title', where: { score: { $gte: 10, $lt: 20 } } }), [{ title: 'A' }, { title: 'C' }]);
      assert.deepStrictEqual(await books.select({ columns: ['title'], sort: 'title', where: { title: { $in: ['A', 'C'] } } }), [{ title: 'A' }, { title: 'C' }]);
      assert.deepStrictEqual(await books.select({ where: { title: { $in: [] } } }), []);
      assert.strictEqual((await books.select({ where: { title: { $nin: [] } } })).length, 4);
      assert.deepStrictEqual(await books.select({ columns: ['title'], sort: 'title', where: { note: { $exists: false } } }), [{ title: 'A' }, { title: 'C' }]);
      assert.deepStrictEqual(await books.select({ columns: ['title'], sort: 'title', where: { note: { $ne: 'x' } } }), [{ title: 'A' }, { title: 'C' }, { title: 'D' }]);
      assert.deepStrictEqual(await books.select({ columns: ['title'], or: [{ where: { title: 'A' } }, { where: { title: 'C' } }], sort: 'title' }), [{ title: 'A' }, { title: 'C' }]);
      assert.deepStrictEqual(await books.select({ columns: ['title'], ids: [secondID] }), [{ title: 'B' }]);

      const adaRelation = { innerColumn: 'id', outerColumn: 'author_id', table: 'authors', where: { name: 'Ada' } };
      assert.deepStrictEqual(await books.select({ columns: ['title'], related: [adaRelation], sort: 'title' }), [{ title: 'A' }, { title: 'B' }]);
      assert.strictEqual(await books.count({ related: [adaRelation] }), 2);
      assert.deepStrictEqual(await books.page({ columns: ['title'], limit: 1, related: [adaRelation], sort: 'title' }), {
        offset: 0,
        rows: [{ title: 'A' }],
        totalRows: 2,
      });
      const emptyRelation = { innerColumn: 'id', outerColumn: 'author_id', table: 'authors', where: { name: { $in: [] } } };
      assert.deepStrictEqual(await books.select({ related: [emptyRelation] }), []);
      assert.deepStrictEqual(
        await books.select({
          columns: ['title'],
          or: [{ related: [emptyRelation] }, { where: { title: 'C' } }],
        }),
        [{ title: 'C' }]
      );

      const publishedBookRelation = {
        innerColumn: 'author_id',
        outerColumn: 'id',
        table: 'authorships',
        through: { joinColumn: 'book_id', relatedColumn: 'id', table: 'books' },
        where: { score: { $gte: 10 } },
      };
      assert.deepStrictEqual(await authors.select({ columns: ['name'], related: [publishedBookRelation], sort: 'name' }), [{ name: 'Ada' }, { name: 'Grace' }]);
      assert.strictEqual(await authors.count({ related: [publishedBookRelation] }), 2);
      assert.deepStrictEqual(await authors.page({ columns: ['name'], limit: 1, related: [publishedBookRelation], sort: 'name' }), {
        offset: 0,
        rows: [{ name: 'Ada' }],
        totalRows: 2,
      });

      const adaCount = await new Promise<number>((resolve, reject) => {
        const result = books.count({ where: { author_id: adaID } }, (error, count) => {
          if (error) reject(error);
          else if (count === undefined) reject(new Error('Missing count'));
          else resolve(count);
        });
        assert.strictEqual(result, undefined);
      });
      assert.strictEqual(adaCount, 2);
      assert.strictEqual(await books.exists({ where: { author_id: graceID } }), true);
      assert.strictEqual(await books.exists({ where: { title: 'missing' } }), false);

      assert.deepStrictEqual(await books.page({ columns: ['title'], limit: 2, offset: 1, sort: 'title' }), {
        offset: 1,
        rows: [{ title: 'B' }, { title: 'C' }],
        totalRows: 4,
      });

      assert.deepStrictEqual(
        await books.select({
          columns: ['id', 'author_id', 'title', 'score'],
          sort: '-score',
          unique: ['author_id'],
        }),
        [
          { author_id: 1, id: 2, score: 20, title: 'B' },
          { author_id: 2, id: 3, score: 15, title: 'C' },
        ]
      );
      assert.strictEqual(await books.count({ unique: ['author_id'] }), 2);

      assert.deepStrictEqual(
        await books.select({
          joins: [{ left: 'books.author_id', right: 'authors.id', table: 'authors' }],
          projections: [
            { as: 'book_title', column: 'books.title' },
            { as: 'author_name', column: 'authors.name' },
          ],
          sort: 'books.title',
          where: { 'authors.name': 'Ada' },
        }),
        [
          { author_name: 'Ada', book_title: 'A' },
          { author_name: 'Ada', book_title: 'B' },
        ]
      );

      await assert.rejects(books.select({ columns: ['title; drop table books'] }), /Selected field is invalid/);
      assert.strictEqual(await bookSchema.hasTable(), true);

      const invalidInsert = books.insert({ 'title; drop table books': 'blocked' });
      await assert.rejects(invalidInsert, /Inserted field is invalid/);

      let invalidUpdateCalls = 0;
      let updateReturned = false;
      await new Promise<void>((resolve, reject) => {
        const result = books.update({ id: firstID }, { 'score; drop table books': 11 }, (error) => {
          invalidUpdateCalls += 1;
          try {
            assert.strictEqual(updateReturned, true);
            assert.match(error?.message ?? '', /Updated field is invalid/);
            queueMicrotask(resolve);
          } catch (assertionError: unknown) {
            reject(assertionError);
          }
        });
        assert.strictEqual(result, undefined);
        updateReturned = true;
      });
      assert.strictEqual(invalidUpdateCalls, 1);

      assert.strictEqual(await books.update({ id: secondID }, { score: 21, title: 'B2' }), 1);
      assert.deepStrictEqual(await books.select({ columns: ['score', 'title'], where: { id: secondID } }), [{ score: 21, title: 'B2' }]);
      assert.strictEqual(await books.delete({ id: { $in: [] } }), 0);
      assert.strictEqual(await books.delete({ id: fourthID }), 1);
      assert.strictEqual(await books.count(), 3);
    } finally {
      await disposeTestConnection(fixture);
    }
  });

  it('returns one deterministic representative for tied unique groups and matching page counts', async () => {
    const fixture = createTestConnection('query-unique-ties', 'items');
    const schema = new SQLSchema(fixture.connection.knex(), 'items');
    const items = new SQLQuery(fixture.connection.knex(), 'items');

    try {
      await schema.ensureSchema([
        { name: 'id', primary: true, type: 'increments' },
        { name: 'group_id', nullable: false, type: 'integer' },
        { name: 'score', nullable: false, type: 'integer' },
        { name: 'priority', nullable: false, type: 'integer' },
      ]);
      await items.insert({ group_id: 1, priority: 1, score: 10 });
      await items.insert({ group_id: 1, priority: 1, score: 10 });

      assert.deepStrictEqual(await items.page({ columns: ['id', 'group_id', 'score'], sort: '-score', unique: ['group_id'] }), {
        offset: 0,
        rows: [{ group_id: 1, id: 1, score: 10 }],
        totalRows: 1,
      });

      await items.insert({ group_id: 2, priority: 2, score: 20 });
      await items.insert({ group_id: 2, priority: 1, score: 20 });
      await items.insert({ group_id: 3, priority: 1, score: 15 });
      await items.insert({ group_id: 3, priority: 1, score: 15 });

      assert.deepStrictEqual(
        await items.select({
          columns: ['id', 'group_id', 'score', 'priority'],
          sort: ['-score', 'priority'],
          unique: ['group_id'],
        }),
        [
          { group_id: 2, id: 4, priority: 1, score: 20 },
          { group_id: 3, id: 5, priority: 1, score: 15 },
          { group_id: 1, id: 1, priority: 1, score: 10 },
        ]
      );

      const nativeRows = await fixture.connection.knex()('items').select('id', 'group_id', 'score', 'priority').orderBy('id');
      assert.deepStrictEqual(nativeRows, [
        { group_id: 1, id: 1, priority: 1, score: 10 },
        { group_id: 1, id: 2, priority: 1, score: 10 },
        { group_id: 2, id: 3, priority: 2, score: 20 },
        { group_id: 2, id: 4, priority: 1, score: 20 },
        { group_id: 3, id: 5, priority: 1, score: 15 },
        { group_id: 3, id: 6, priority: 1, score: 15 },
      ]);
      const requestedColumns = Object.freeze(['group_id', 'priority']);
      const hiddenSort = Object.freeze(['-score', 'priority']);
      assert.deepStrictEqual(
        await items.select({ columns: requestedColumns, sort: hiddenSort, unique: ['group_id'] }),
        [{ group_id: 2, priority: 1 }, { group_id: 3, priority: 1 }, { group_id: 1, priority: 1 }]
      );
      assert.deepStrictEqual(
        await items.select({ columns: ['id'], sort: ['-score', 'priority'], unique: ['group_id'] }),
        [{ id: 4 }, { id: 5 }, { id: 1 }]
      );
      assert.deepStrictEqual(await items.select({ columns: ['priority'], unique: ['group_id'] }), [{ priority: 1 }, { priority: 2 }, { priority: 1 }]);
      assert.deepStrictEqual(
        await items.page({ columns: ['group_id', 'priority'], limit: 1, offset: 1, sort: ['-score', 'priority'], unique: ['group_id'], where: { group_id: { $in: [1, 2] } } }),
        { offset: 1, rows: [{ group_id: 1, priority: 1 }], totalRows: 2 }
      );
      await assert.rejects(items.select({ columns: ['priority'], sort: '-score; drop table items', unique: ['group_id'] }), /Sort field is invalid/);
      await assert.rejects(items.select({ columns: ['priority'], sort: 'items.score', unique: ['group_id'] }), /Unique query sort field must be unqualified/);
      assert.deepStrictEqual(await fixture.connection.knex()('items').select('id', 'group_id', 'score', 'priority').orderBy('id'), nativeRows);
    } finally {
      await disposeTestConnection(fixture);
    }
  });
});

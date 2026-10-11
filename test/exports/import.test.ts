import assert from 'node:assert';
import BackboneORM from 'backbone-orm';
import BackboneSQL, { Backbone, configure, modules, sync } from 'backbone-sql';

describe('TypeScript package exports', () => {
  it('resolves the package-name entry and preserved public surface', () => {
    assert.strictEqual(BackboneSQL.sync, sync);
    assert.strictEqual(BackboneSQL.configure, configure);
    assert.strictEqual(BackboneSQL.Backbone, Backbone);
    assert.strictEqual(Backbone, BackboneORM.Backbone);
    assert.strictEqual(modules['backbone-orm'], BackboneORM);
  });
});

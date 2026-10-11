const assert = require('assert');
const BackboneORM = require('backbone-orm');
const BackboneSQL = require('backbone-sql');

assert.strictEqual(typeof BackboneSQL.configure, 'function');
assert.strictEqual(typeof BackboneSQL.sync, 'function');
assert.strictEqual(BackboneSQL.Backbone, BackboneORM.Backbone);
assert.strictEqual(BackboneSQL.modules['backbone-orm'], BackboneORM);
assert.strictEqual(BackboneSQL.sync.capabilities('sqlite3:///items').embed, false);

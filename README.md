# BackboneSQL

Persist BackboneORM models to SQLite or PostgreSQL using the `backbone-sql` package.

This README describes the locally reviewed modernization candidate, not an announced npm release. SQLite and selected PostgreSQL behavior have local integration evidence. MySQL is pending. A green local slice does not establish full dialect support or release readiness.

## Requirements and local setup

The package declares Node.js 18 or newer. Current native SQLite and PostgreSQL validation uses Node.js 20.20.2. The complete declared runtime range is not yet validated.

The candidate uses Backbone 1.6.1, Knex 3.3.0, better-sqlite3 11.10.0 and pg 8.20.0. Import Backbone from `backbone-sql` when defining models so they use the adapter's Backbone instance.

Use the maintainer-provided local artifact or link setup with its matching BackboneORM input. The current package still references a machine-local ORM file dependency, so it does not yet provide a portable standalone installation procedure. Do not assume `npm install backbone-sql` supplies this candidate.

The package has native CommonJS and ESM entries:

```javascript
import BackboneSQL from 'backbone-sql';
// CommonJS: const BackboneSQL = require('backbone-sql');
```

## First SQLite model

The following complete ESM example creates an in-memory database, ensures its table, saves a model, fetches it and closes the shared connection. Save it as `example.mjs` in an application where the reviewed candidate and matching ORM resolve by package name, then run `node example.mjs`.

This exact example has been verified on Node.js 20.20.2 using the matching local SQL and ORM artifacts. This does not verify a portable npm installation.

```javascript
import BackboneSQL from 'backbone-sql';

const Project = BackboneSQL.Backbone.Model.extend({
  urlRoot: 'sqlite3:///projects',
  schema: {
    name: ['String', { nullable: false }],
    score: 'Integer',
    active: 'Boolean',
  },
});

BackboneSQL.sync(Project, { filename: ':memory:' });
const db = Project.db();
const failures = [];

try {
  await new Promise((resolve, reject) => {
    db.ensureSchema((error) => error ? reject(error) : resolve());
  });

  const project = new Project({
    name: 'first project',
    score: 10,
    active: true,
  });
  await project.save();

  const fetched = new Project({ id: project.id });
  await fetched.fetch();
  console.log(fetched.get('name'), fetched.get('score')); // first project 10
} catch (error) {
  failures.push(error);
}

try {
  await Project.prototype.sync('closeConnection');
} catch (error) {
  failures.push(error);
}

if (failures.length === 1) throw failures[0];
if (failures.length > 1) {
  throw new AggregateError(failures, 'Project operation and connection cleanup failed');
}
```

The factory installs the model's sync method and ORM controls. Use `filename` to choose a SQLite file, or `:memory:` for an ephemeral database. Create any parent directory before opening a file.

`db.ensureSchema(callback)` requires a callback and returns void. It creates missing tables and adds missing columns; it does not alter existing column definitions. `db.resetSchema(callback)` is destructive and is not needed for first use.

Models using the same normalized database URL and credentials share a connection. SQLite filename overrides must agree for that connection key. Finish all operations using a handle before calling `sync('closeConnection')` on a configured model. Closing it releases that pool entry and affects every model using the same handle. It does not delete a SQLite file or stop a PostgreSQL server you own.

## PostgreSQL setup and scope

Provide your own PostgreSQL database and role with permission to create tables and read/write the intended data. The package does not start or distribute a PostgreSQL server. Local validation uses PostgreSQL 18.4 on the reviewed current host.

A model URL includes the host, optional authentication, port, database and table, for example:

```text
postgres://127.0.0.1:5432/my_database/projects
```

Use `pg:` or `postgres:`, not `postgresql:`. Define a fresh `Project` model with its PostgreSQL `urlRoot` set before calling `BackboneSQL.sync(Project)`, without a SQLite filename option. Keep real credentials out of source and logs.

The current PostgreSQL path has no SSL configuration. URL query strings, fragments, host lists and schema-qualified table names are rejected. Do not use it for an endpoint that requires SSL. Replica/slave options are not implemented.

The locally exercised scope includes model CRUD, selected cursor queries and projections, native Boolean/DateTime/JSON reads, table controls, belongsTo/hasOne/hasMany persistence and one-hop includes/predicates, and many-to-many pivot lifecycle/includes/predicates. Related models must use this adapter's active sync and the exact same owned connection. This is not an assertion that every BackboneORM or Knex feature works.

Self, embedded and virtual relations and nested relation traversal are not implemented. Neither relation saves nor schema operations promise transactions, rollback or atomicity. Identifiers use ASCII letters, digits and underscores, with a letter or underscore first. Keep table, column and generated pivot/index names short; the PostgreSQL long-identifier/collision policy remains unresolved.

## Schema definition

A model's `schema` maps non-relation fields to database columns. Use a type name alone or an array containing the type and its options, as in the example above. The default `id` is an auto-incrementing primary key; manual IDs are not an advertised capability.

Recognized scalar type names are `String`, `Text`, `Integer`, `BigInteger`, `Float`, `Decimal`, `Boolean`, `Date`, `DateTime`, `Timestamp`, `Binary` and `JSON`. Type matching is case-insensitive. This is a fixed adapter list, not all Knex schema methods. Native values and applicable options differ by dialect.

Common field options are:

- `nullable`: columns are nullable unless set to false.
- `indexed`: set to true to request an index when the column is created.
- `unique`: set to true to request a unique constraint when the column is created.

These options apply on column creation. Ensuring an existing table does not retrofit indexes, constraints or types onto already present columns.

SQLite DateTime database reads currently return numeric milliseconds; a saved-model cache hit can retain a Date. Do not rely on uniform Date hydration across database reads and cache hits.

## Development

Use the existing package scripts, not gulp:

```sh
npm run build
npm test
npm run format
```

The test script builds both formats, runs normal Node owner tests and runs the managed declaration gate. The full suite requires the reviewed private PostgreSQL test runtime through `TEST_POSTGRES_RUNTIME`; it does not fall back to a global server. Obtain that test input from the maintainer before running the suite.

`npm run test:engines` is the existing Node engine-test script. Its presence is not evidence that the declared range has passed.

## License and help

[MIT license](LICENSE). Report problems through the [repository issue tracker](https://github.com/vidigami/backbone-sql/issues).

import assert from 'assert';

import { nativeToAttributes } from '../../../src/lib/nativeToAttributes.ts';

describe('internal schema native-to-attribute conversion', () => {
  it('preserves retained Boolean truthiness, nulls, and unrelated or absent fields', () => {
    const schema = { fields: { active: { type: 'Boolean' }, numeric: { type: 'Integer' }, lowercase: { type: 'boolean' } } };
    for (const [input, expected] of [
      [0, false],
      [1, true],
      [2, true],
      ['', false],
      ['0', true],
      [true, true],
      [false, false],
      [null, null],
      [undefined, false],
    ]) {
      const row = { active: input, lowercase: 0, numeric: 1, untyped: 0 };
      nativeToAttributes(row, schema);
      assert.deepStrictEqual(row, { active: expected, lowercase: 0, numeric: 1, untyped: 0 });
    }
    const absent = { numeric: 0 };
    nativeToAttributes(absent, schema);
    assert.deepStrictEqual(absent, { numeric: 0 });
  });
});

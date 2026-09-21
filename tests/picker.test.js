'use strict';
/*
 * Finding an item in the line picker.
 *
 * Every document — a quotation, an LPO, a client's order, an invoice — picks
 * its lines through the same box: type part of a code or a name, choose from
 * what comes back. The catalogue is fetched once and searched in the browser,
 * so this is browser code; it is loaded here in a sandbox and asked the same
 * questions a person types.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Load the browser file and hand back what it hangs on `window`. */
function loadPicker() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'doclines.js'), 'utf8');
  const sandbox = {
    window: {},
    document: { createElement: () => ({ style: {} }) },
    UI: { esc: (v) => String(v === undefined || v === null ? '' : v), money: (n) => String(n) },
    APP: { seesCost: () => true, seesPrices: () => true, vatPercent: 5 },
    API: { get: async () => ({ rows: [] }) },
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.LINES;
}

const CATALOGUE = [
  { id: 1, item_code: 'AKR-FST-00001', name: 'Hex Bolt & Nut Set — SS316', size: 'M16 x 70',
    material: 'Stainless Steel 316', category_name: 'Fasteners', application_name: 'Potable Water' },
  { id: 2, item_code: 'AKR-VLP-00027', name: 'ZZZ Brand New Widget', category_name: 'Valves' },
  { id: 3, item_code: 'AKR-VLS-00014', name: 'Gate Valve', brand: 'Gulf Valve',
    mfr_part_no: 'GVM-441-X', size: 'DN200', category_name: 'Valves' },
];

test('an item is found by its code, in either case', () => {
  const { search } = loadPicker();
  /*
   * This is the one that was broken. The haystack was built by adding two
   * strings and lowering only the second, so the code and the name — the two
   * things anybody types — kept their capitals and never matched a lower-cased
   * term. The picker answered nothing to every search and everything to an
   * empty box, which reads exactly like a newly added item having failed to
   * save.
   */
  assert.equal(search(CATALOGUE, 'AKR-FST-00001').length, 1, 'the code as printed');
  assert.equal(search(CATALOGUE, 'akr-fst-00001').length, 1, 'and typed in lower case');
  assert.equal(search(CATALOGUE, 'FST').length, 1, 'or part of it');
});

test('an item is found by its name, whatever case it is typed in', () => {
  const { search } = loadPicker();
  for (const term of ['Hex', 'hex', 'HEX', 'hex bolt', 'BOLT nut']) {
    assert.equal(search(CATALOGUE, term).length, 1, `"${term}" finds the hex bolt`);
  }
  assert.equal(search(CATALOGUE, 'ZZZ')[0].id, 2, 'and a brand new item is found the same way');
});

test('the other things printed on an item are searchable too', () => {
  const { search } = loadPicker();
  assert.equal(search(CATALOGUE, 'M16')[0].id, 1, 'the size');
  assert.equal(search(CATALOGUE, 'stainless')[0].id, 1, 'the material');
  assert.equal(search(CATALOGUE, 'gvm-441')[0].id, 3, "the maker's part number");
  assert.equal(search(CATALOGUE, 'Gulf')[0].id, 3, 'the brand');
  assert.equal(search(CATALOGUE, 'potable')[0].id, 1, 'the application');
  assert.equal(search(CATALOGUE, 'valves').length, 2, 'and the product line');
});

test('every word has to match, and an empty box offers the catalogue', () => {
  const { search } = loadPicker();
  assert.equal(search(CATALOGUE, 'hex valve').length, 0, 'not a match on either word alone');
  assert.equal(search(CATALOGUE, '').length, CATALOGUE.length);
  assert.equal(search(CATALOGUE, '   ').length, CATALOGUE.length, 'nor on spaces');
  assert.equal(search(CATALOGUE, 'nothing at all like this').length, 0);
});

test('an item with almost nothing filled in is still findable', () => {
  const { search } = loadPicker();
  // A brand new item has a code, a name and a category, and nothing else yet.
  const bare = [{ id: 9, item_code: 'AKR-GEN-00001', name: 'Just Added' }];
  assert.equal(search(bare, 'just added').length, 1);
  assert.equal(search(bare, 'GEN-00001').length, 1);
});

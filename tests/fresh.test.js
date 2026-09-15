'use strict';
/*
 * Going live: clearing the demo data without clearing the setup.
 *
 * A new installation comes with something to look at — fictional clients and
 * manufacturers, a catalogue of invented part numbers, and whatever was entered
 * while the system was being tried. None of that belongs in the books a company
 * trades on. What must survive is everything somebody configured on purpose:
 * the group companies, the desks, the payment terms, the product groups, the
 * expense heads and the terms & conditions library.
 *
 * This runs the real command in a real database, because a tool that deletes
 * things is the last place to take a guess.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB = require('better-sqlite3');

const build = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akr-fresh-'));
  const env = { ...process.env, DATA_DIR: dir, AUTO_SEED: 'false', NODE_ENV: 'test' };
  execFileSync(process.execPath, [path.join(ROOT, 'src/db/seed.js')], { env, stdio: 'ignore' });
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/demo-walkthrough.js')], { env, stdio: 'ignore' });
  return { dir, env, file: path.join(dir, 'akr.db') };
};

const counts = (file, tables) => {
  const db = new DB(file, { readonly: true });
  const out = {};
  for (const t of tables) out[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  db.close();
  return out;
};

const run = (env, args = []) =>
  execFileSync(process.execPath, [path.join(ROOT, 'src/db/fresh.js'), ...args],
    { env, encoding: 'utf8' });

const MASTERS = ['companies', 'users', 'applications', 'item_categories', 'item_subgroups',
  'payment_terms', 'expense_categories', 'terms_clauses', 'locations'];

test('with no argument it changes nothing and says what each choice would clear', () => {
  const { env, file } = build();
  const before = counts(file, [...MASTERS, 'items', 'partners', 'sales_invoices']);

  const out = run(env);
  assert.match(out, /npm run fresh -- --books/);
  assert.match(out, /npm run fresh -- --all/);
  assert.match(out, /Nothing has been changed/);

  assert.deepEqual(counts(file, Object.keys(before)), before, 'and it means it');
});

test('--books empties the books and keeps every master', () => {
  const { env, file } = build();
  const had = counts(file, ['sales_invoices', 'purchase_orders', 'expenses', 'stock_movements']);
  assert.ok(Object.values(had).some((c) => c > 0), 'the walk-through wrote a trade to clear');
  const masters = counts(file, [...MASTERS, 'items', 'partners']);

  run(env, ['--books']);

  const after = counts(file, ['sales_invoices', 'purchase_orders', 'expenses', 'stock_movements',
    'enquiries', 'payments', 'grns', 'audit_logs']);
  for (const [t, c] of Object.entries(after)) assert.equal(c, 0, `${t} is empty`);

  assert.deepEqual(counts(file, [...MASTERS, 'items', 'partners']), masters,
    'the catalogue, the accounts and everything configured are untouched');
});

test('--all also clears the sample accounts and the sample catalogue', () => {
  const { env, file } = build();
  const masters = counts(file, MASTERS);

  run(env, ['--all']);

  const gone = counts(file, ['items', 'partners', 'sales_invoices', 'counters']);
  for (const [t, c] of Object.entries(gone)) assert.equal(c, 0, `${t} is empty`);

  assert.deepEqual(counts(file, MASTERS), masters,
    'the group companies, the desks and the setup all survive');
});

test('it copies the database before deleting anything', () => {
  const { dir, env } = build();
  run(env, ['--all']);
  const copies = fs.readdirSync(dir).filter((f) => f.includes('.before-fresh-'));
  assert.equal(copies.length, 1, 'a copy is left beside the database');
  const backup = counts(path.join(dir, copies[0]), ['items', 'partners']);
  assert.ok(backup.items > 0 && backup.partners > 0, 'and it still holds what was cleared');
});

test('the seeder does not put the demo data back on the next start', () => {
  /*
   * The application seeds itself when it finds no accounts at all, which is
   * what makes a first deploy work. Clearing the books leaves the desks in
   * place, so that must not fire — or going live would undo itself on the next
   * restart.
   */
  const { env, file } = build();
  run(env, ['--all']);
  assert.ok(counts(file, ['users']).users > 0, 'the desks are still there');

  const server = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
  assert.match(server, /const users = db\.prepare\('SELECT COUNT\(\*\) AS c FROM users'\)\.get\(\)\.c;\s*\n\s*if \(users > 0\) return;/,
    'and the seeder stands down whenever any account exists');
});

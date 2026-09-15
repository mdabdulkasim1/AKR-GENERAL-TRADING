'use strict';
/*
 * Clear the demo data, and go live.
 *
 * A new installation is seeded with something to look at: fictional clients and
 * manufacturers, a catalogue of made-up part numbers, and whatever was entered
 * while the system was being tried out. None of that belongs in the books a
 * company actually trades on — a fabricated part number quoted to a client is
 * worse than an empty catalogue.
 *
 * What is never touched is the configuration: the group companies, the desks
 * and who may open what, the payment terms, the applications, the product
 * groups, the expense heads and the terms & conditions library. Those were set
 * up deliberately and clearing them would mean doing that work again.
 *
 * Nothing happens without saying which. Run it with no argument and it reports
 * what each choice would remove and stops.
 *
 *   npm run fresh -- --books    empty the books, keep every master
 *   npm run fresh -- --all      the books, and the sample accounts and items
 *
 * The database file is copied beside itself before anything is deleted.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { db } = require('./index');

/* Children before parents: SQLite will not let a row go while another points at it. */
const BOOKS = [
  'payment_allocations', 'payments',
  'sales_invoice_items', 'sales_invoices',
  'delivery_note_items', 'delivery_notes',
  'sales_order_items', 'sales_orders',
  'sales_quotation_items', 'sales_quotations',
  'supplier_invoice_items', 'supplier_invoices',
  'grn_items', 'grns',
  'purchase_order_items', 'purchase_orders',
  'supplier_quotation_items', 'supplier_quotations',
  'enquiries', 'expenses', 'stock_movements',
  'attachments', 'notifications', 'audit_logs', 'sessions',
];

/* The sample accounts and the sample catalogue. */
const SAMPLES = ['item_suppliers', 'items', 'partner_contacts', 'partners'];

/* Document numbering starts again at 001, which it cannot do with the old
 * counters still standing. */
const NUMBERING = ['counters', 'document_series'];

const KEPT = ['companies', 'users', 'user_screens', 'applications', 'item_categories',
  'item_subgroups', 'payment_terms', 'expense_categories', 'terms_clauses', 'locations'];

const count = (table) => {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  } catch {
    return 0;
  }
};

const report = (label, tables) => {
  const rows = tables.map((t) => [t, count(t)]).filter(([, c]) => c > 0);
  const total = rows.reduce((a, [, c]) => a + c, 0);
  console.log(`\n  ${label} — ${total} row${total === 1 ? '' : 's'}`);
  for (const [t, c] of rows) console.log(`    ${String(c).padStart(6)}  ${t}`);
  if (!rows.length) console.log('           (nothing)');
  return total;
};

const mode = process.argv.includes('--all') ? 'all'
  : (process.argv.includes('--books') ? 'books' : null);

console.log(`\n  Database: ${config.dbFile}`);
report('The books', BOOKS);
report('Sample accounts and catalogue', SAMPLES);
report('Kept either way', KEPT);

if (!mode) {
  console.log('\n  Nothing has been changed. Choose what to clear:\n');
  console.log('    npm run fresh -- --books    empty the books, keep every master');
  console.log('    npm run fresh -- --all      the books, and the sample accounts and items\n');
  process.exit(0);
}

// A copy first. The one thing worse than demo data is no data.
const backup = `${config.dbFile}.before-fresh-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
fs.mkdirSync(path.dirname(backup), { recursive: true });
db.pragma('wal_checkpoint(TRUNCATE)');
fs.copyFileSync(config.dbFile, backup);
console.log(`\n  Copied to ${backup}`);

const tables = mode === 'all' ? [...BOOKS, ...SAMPLES, ...NUMBERING] : [...BOOKS, ...NUMBERING];
const wipe = db.transaction(() => {
  for (const t of tables) {
    try {
      db.prepare(`DELETE FROM ${t}`).run();
    } catch (err) {
      console.warn(`  ! ${t}: ${err.message}`);
    }
  }
});
wipe();
db.exec('VACUUM');

console.log(`\n  Cleared${mode === 'all' ? ' the books, the sample accounts and the catalogue' : ' the books'}.`);
console.log('  Document numbering starts again at 001.');
console.log(`  ${count('users')} desks, ${count('companies')} companies, ${count('payment_terms')} payment terms `
  + `and ${count('terms_clauses')} clauses are untouched.\n`);

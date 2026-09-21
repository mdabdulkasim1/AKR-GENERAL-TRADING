'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/** Adds a column if it is missing. Returns true when it actually added it. */
function ensureColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (exists) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

/** Run the schema file — safe to call repeatedly (everything is IF NOT EXISTS). */
function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  // Columns added after the first release, for databases created before them.
  ensureColumn('items', 'subgroup_id', 'INTEGER REFERENCES item_subgroups(id)');
  for (const col of ['attention', 'incoterms', 'authority']) {
    ensureColumn('purchase_orders', col, 'TEXT');
  }
  for (const col of ['purchase_officer', 'purchase_officer_mobile', 'delivery_contact',
    'delivery_mobile', 'delivery_location']) {
    ensureColumn('sales_orders', col, 'TEXT');
  }
  // Enquiries run on both sides of the trade; everything logged before that
  // was a client's.
  ensureColumn('enquiries', 'side', "TEXT NOT NULL DEFAULT 'client'");
  ensureColumn('supplier_quotations', 'enquiry_id', 'INTEGER REFERENCES enquiries(id)');
  // The enquiry number travels the length of the buy side: onto the order the
  // supplier holds, and onto what we file when the goods and the bill arrive.
  for (const table of ['purchase_orders', 'grns', 'supplier_invoices', 'payments',
    'sales_orders', 'delivery_notes', 'sales_invoices', 'expenses']) {
    ensureColumn(table, 'enquiry_id', 'INTEGER REFERENCES enquiries(id)');
  }
  // Indexed here rather than in the schema: on a database created before the
  // column existed, the schema runs before the column is added.
  db.exec('CREATE INDEX IF NOT EXISTS idx_enquiries_side ON enquiries(side, status)');
  // What an expense was spent against: the LPO, either direction — ours to a
  // manufacturer, or the client's to us.
  ensureColumn('expenses', 'po_id', 'INTEGER REFERENCES purchase_orders(id)');
  ensureColumn('expenses', 'so_id', 'INTEGER REFERENCES sales_orders(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_po ON expenses(po_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_expenses_so ON expenses(so_id)');
  /*
   * What a document was priced in, where it was not dirhams.
   *
   * The currency column has always been there; the rate it was converted at
   * has not, and without it a euro order cannot be read back into the books
   * months later at the rate that was actually agreed.
   */
  for (const table of ['purchase_orders', 'sales_quotations', 'supplier_quotations']) {
    ensureColumn(table, 'exchange_rate', 'REAL NOT NULL DEFAULT 1');
  }
  /*
   * Lead time in weeks, which is how this trade actually quotes it.
   *
   * A maker says six to eight weeks, never forty-two days. The days column
   * stays and is kept in step, so anything already written against it — a
   * printed quotation, a clause that cites the lead time — still reads true;
   * weeks is what is entered and what is shown. Rows written before this are
   * carried across once, rounding a part week up, because a lead time that
   * rounds down is a promise the company cannot keep.
   */
  correctSeededContactDetails();
  for (const table of ['sales_quotations', 'supplier_quotations']) {
    if (ensureColumn(table, 'delivery_weeks', 'INTEGER NOT NULL DEFAULT 0')) {
      db.prepare(`UPDATE ${table} SET delivery_weeks = CAST((delivery_days + 6) / 7 AS INTEGER)
                   WHERE delivery_days > 0`).run();
    }
  }
  ensureCostingHeads();
  // The working behind a quoted rate, on the line it belongs to.
  ensureColumn('sales_quotation_items', 'cost_build', 'TEXT');
  return db;
}

/*
 * The company's real address and telephone number.
 *
 * The first version shipped with a placeholder tower, a wrong post box and a
 * telephone number of all zeroes, and those are what has been printing on the
 * head of every quotation, LPO and tax invoice. A client rings the number on
 * the invoice.
 *
 * Only rows that still hold the placeholder are corrected. Anything somebody
 * has already typed for themselves is theirs and is left exactly as it is.
 */
const REAL = {
  address: '206 & 706, Park Avenue Building, DSO, Dubai, UAE — P.O. Box 1955',
  phone: '+971 4 269 1370',
  website: 'www.akr365.com',
};

function correctSeededContactDetails() {
  try {
    /*
     * The sister companies are seeded with no address at all, which prints an
     * empty letterhead. They sit at the group's own office until somebody says
     * otherwise, so they get the same details — and anyone who wants their own
     * types them under Masters -> Companies.
     */
    db.prepare(`UPDATE companies SET address = @address
                 WHERE address IS NULL OR address = ''
                    OR address LIKE '%Park Avenue Tower%' OR address LIKE '%19556%'`).run(REAL);
    db.prepare(`UPDATE companies SET phone = @phone
                 WHERE phone IS NULL OR phone IN ('+971 4 000 0000', '')`).run(REAL);
    db.prepare(`UPDATE companies SET email = 'sales@akr365.com'
                 WHERE email IS NULL OR email = ''`).run();
    /*
     * The yard has its own copy of the address, and it is the one that prints
     * under "Deliver to" on every LPO — so a maker sent material to the tower
     * that is not the building.
     */
    db.prepare(`UPDATE locations SET address = @address
                 WHERE address LIKE '%Park Avenue Tower%' OR address LIKE '%19556%'`).run(REAL);
    /*
     * And every document that took its copy of that address before the yard
     * was corrected. The delivery address is snapshotted onto the order when
     * it is raised, so fixing the location alone leaves an LPO already on a
     * supplier's desk still pointing at the wrong building — which is the one
     * place the mistake actually costs something.
     */
    for (const table of ['purchase_orders', 'sales_orders', 'delivery_notes']) {
      db.prepare(`UPDATE ${table} SET delivery_address = @address
                   WHERE delivery_address LIKE '%Park Avenue Tower%'
                      OR delivery_address LIKE '%19556%'`).run(REAL);
    }
    /*
     * A tax invoice snapshots the company's address at issue, and reprints as
     * it was issued — which is right, and is why this is narrowed to the one
     * string that was never the company's address in the first place. An
     * invoice bearing a placeholder is not a record of anything; it is a
     * mistake, and a UAE tax invoice showing the wrong address is one the FTA
     * would have something to say about.
     */
    db.prepare(`UPDATE sales_invoices SET company_address = @address
                 WHERE company_address LIKE '%Park Avenue Tower%'
                    OR company_address LIKE '%19556%'`).run(REAL);
    db.prepare("UPDATE companies SET website = @website WHERE website IS NULL OR website = ''")
      .run(REAL);
  } catch (err) {
    // A contact detail is not worth refusing to start over.
    console.warn('[setup] contact details:', err.message);
  }
}

/*
 * The company's own costing heads, on a database that predates them.
 *
 * These are the words the rate builder uses at the quote stage, so an expense
 * can be booked under the head it was quoted under — which is the whole point
 * of them. Added by code, never renamed or removed: an installation that has
 * edited its own heads keeps them, and one that has deleted a head it does not
 * use does not have it put back.
 */
const COSTING_HEADS = [
  ['EXR', 'Exchange risk', 1],
  ['PACK', 'Packing', 2],
  ['SHIP', 'Shipping', 3],
  ['INSC', 'Insurance — consignment', 4],
  ['CUST', 'Custom clearance', 5],
  ['PBG', 'PBG — performance bank guarantee', 6],
  ['RETN', 'Retention', 7],
  ['VMI', 'VMI — vendor managed inventory', 8],
  ['DELC', 'Delivery charges', 9],
  ['COLC', 'Collection charges', 10],
  ['REPR', 'Other expenses — repair', 11],
];

function ensureCostingHeads() {
  const seen = db.prepare('SELECT code FROM expense_categories').all().map((r) => r.code);
  if (!seen.length) return;               // a fresh database is the seed's business
  const add = db.prepare(
    'INSERT INTO expense_categories (code, name, kind, sort_order) VALUES (?, ?, \'expense\', ?)');
  for (const [code, name, order] of COSTING_HEADS) {
    // Sorted ahead of whatever is already there rather than renumbering it:
    // an installation that has ordered its own heads keeps that order.
    if (!seen.includes(code)) add.run(code, name, order - 100);
  }
}

/** Wrap a function in a transaction. */
const tx = (fn) => db.transaction(fn);

// Apply the schema on load. Every statement is idempotent, which removes any
// module-ordering hazard around prepared statements.
migrate();

module.exports = { db, migrate, tx, ensureColumn };

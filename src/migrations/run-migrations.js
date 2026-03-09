const db = require('../config/database');

const migrations = [
  {
    name: 'messages.message_type',
    sql: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT`,
  },
  {
    name: 'practices.google_review_link',
    sql: `ALTER TABLE practices ADD COLUMN IF NOT EXISTS google_review_link TEXT`,
  },
  {
    name: 'practices.reviews_enabled',
    sql: `ALTER TABLE practices ADD COLUMN IF NOT EXISTS reviews_enabled BOOLEAN DEFAULT true`,
  },
  {
    name: 'practices.last_inbox_viewed_at',
    sql: `ALTER TABLE practices ADD COLUMN IF NOT EXISTS last_inbox_viewed_at TIMESTAMP`,
  },
  {
    name: 'alerts.unresolved_unique_index',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS alerts_unresolved_unique ON alerts (patient_id, alert_type) WHERE resolved = false`,
  },
];

async function runMigrations() {
  console.log('[Migrations] Running startup migrations…');
  for (const migration of migrations) {
    try {
      await db.query(migration.sql);
      console.log(`[Migrations] ✓ ${migration.name}`);
    } catch (err) {
      console.error(`[Migrations] ✗ ${migration.name}:`, err.message);
      throw err;
    }
  }
  console.log('[Migrations] All migrations complete');
}

module.exports = { runMigrations };

-- Money is stored as INTEGER cents, never as a float. 12.50 EUR -> 1250.
-- This avoids the classic floating-point rounding bugs when summing prices.

PRAGMA journal_mode = WAL;     -- better read/write concurrency; also what Litestream needs later
PRAGMA foreign_keys = ON;      -- enforce the attachment -> purchase relationship

CREATE TABLE IF NOT EXISTS purchases (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT    NOT NULL,        -- ISO 'YYYY-MM-DD'; month is derived from this, no separate month column
    concept      TEXT    NOT NULL,
    detail       TEXT    NOT NULL DEFAULT '',  -- free-text notes for the purchase
    amount_cents INTEGER NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Filtering a month is the hot query, so index the derived month.
CREATE INDEX IF NOT EXISTS idx_purchases_month
    ON purchases (substr(date, 1, 7));

CREATE TABLE IF NOT EXISTS attachments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id  INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    filename     TEXT    NOT NULL,
    mime         TEXT    NOT NULL,        -- e.g. 'application/pdf', 'image/jpeg'
    data         BLOB    NOT NULL,        -- the receipt bytes live in the DB, so one file backs up everything
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attachments_purchase
    ON attachments (purchase_id);

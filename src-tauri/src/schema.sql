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
    seq          INTEGER NOT NULL DEFAULT 0,  -- order within the same day (drag to reorder)
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

-- Optional per-concept color for the charts. No row = default (theme green).
CREATE TABLE IF NOT EXISTS concept_colors (
    concept TEXT PRIMARY KEY,
    color   TEXT NOT NULL
);

-- User-made lists that group purchases across months (a renovation, a trip,
-- tax-deductible items…). A purchase can be in any number of lists; deleting a
-- list never deletes purchases, and deleting a purchase drops it from its lists.
CREATE TABLE IF NOT EXISTS lists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS list_items (
    list_id      INTEGER NOT NULL REFERENCES lists(id)     ON DELETE CASCADE,
    purchase_id  INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    added_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (list_id, purchase_id)
);

CREATE INDEX IF NOT EXISTS idx_list_items_purchase
    ON list_items (purchase_id);

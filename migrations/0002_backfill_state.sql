CREATE TABLE IF NOT EXISTS backfill_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cursor TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO backfill_state (id, cursor, completed)
VALUES (1, NULL, 0);
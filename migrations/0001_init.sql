CREATE TABLE IF NOT EXISTS sales (
    purchase_token TEXT PRIMARY KEY,
    buyer TEXT NOT NULL,
    item_name TEXT NOT NULL,
    asset_id INTEGER,
    amount INTEGER NOT NULL,
    created TEXT NOT NULL,
    notified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created);
CREATE INDEX IF NOT EXISTS idx_sales_item_name ON sales(item_name);
CREATE INDEX IF NOT EXISTS idx_sales_amount ON sales(amount);

-- Companion Cockpit v2 D1 Schema (SQLite)

CREATE TABLE IF NOT EXISTS fast_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  json_data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  due_date TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT '未完了',
  created_at TEXT DEFAULT '',
  completed_at TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  remind_context TEXT DEFAULT '',
  doc_url TEXT DEFAULT '',
  estimated_mins INTEGER DEFAULT 30,
  sheet_row INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS shopping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT NOT NULL,
  category TEXT DEFAULT '日用品',
  status TEXT NOT NULL DEFAULT '未買',
  created_at TEXT DEFAULT '',
  sheet_row INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shopping_status ON shopping(status);

CREATE TABLE IF NOT EXISTS input_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT '映画',
  title TEXT NOT NULL,
  memo TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT '未',
  consumed_at TEXT DEFAULT '',
  estimated_mins INTEGER DEFAULT 30,
  sheet_row INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_input_stock_status ON input_stock(status);

CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT DEFAULT '',
  last_generated_at TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT '有効',
  completed_at TEXT DEFAULT '',
  estimated_mins INTEGER DEFAULT 30,
  sheet_row INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_str TEXT NOT NULL,
  sender TEXT NOT NULL,
  message TEXT NOT NULL,
  image_url TEXT DEFAULT '',
  ai_reply TEXT DEFAULT '',
  meta_json TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp_str);

CREATE TABLE IF NOT EXISTS memory (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_ops (
  op_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mirror_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

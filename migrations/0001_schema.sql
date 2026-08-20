PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('owner','admin','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'digital',
  brand TEXT,
  short_description TEXT,
  full_description TEXT,
  audience TEXT,
  features_json TEXT NOT NULL DEFAULT '[]',
  benefits_json TEXT NOT NULL DEFAULT '[]',
  price_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  sales_url TEXT,
  freebie_url TEXT,
  external_ids_json TEXT NOT NULL DEFAULT '{}',
  launch_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','retired')),
  manual_priority REAL NOT NULL DEFAULT 1.0,
  link_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  aspect_ratio TEXT,
  campaign_type TEXT,
  theme TEXT,
  audience TEXT,
  platforms_json TEXT NOT NULL DEFAULT '[]',
  has_qr INTEGER NOT NULL DEFAULT 0,
  has_testimonial INTEGER NOT NULL DEFAULT 0,
  main_message TEXT,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('approved','experimental','draft','paused','retired')),
  sha256 TEXT,
  perceptual_hint TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_product ON assets(product_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_last_used ON assets(last_used_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS copy_items (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  copy_type TEXT NOT NULL,
  text TEXT NOT NULL,
  audience TEXT,
  platform TEXT,
  purpose TEXT,
  tone TEXT,
  length_class TEXT,
  campaign_type TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','experimental','draft','paused','retired')),
  source TEXT NOT NULL DEFAULT 'human' CHECK(source IN ('human','ai','imported','system')),
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_copy_product ON copy_items(product_id);
CREATE INDEX IF NOT EXISTS idx_copy_status ON copy_items(status);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','completed','cancelled')),
  autopilot INTEGER NOT NULL DEFAULT 1,
  generated_at TEXT NOT NULL,
  generated_by TEXT NOT NULL DEFAULT 'engine',
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_campaign_week ON campaigns(week_start);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  copy_id TEXT REFERENCES copy_items(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  caption TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('draft','scheduled','approved','publishing','published','simulated','failed','rejected','paused')),
  approval_mode TEXT NOT NULL DEFAULT 'autopilot' CHECK(approval_mode IN ('autopilot','manual')),
  connector_type TEXT,
  connector_id TEXT,
  external_post_id TEXT,
  tracking_code TEXT NOT NULL UNIQUE,
  error_message TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_due ON scheduled_posts(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_posts_campaign ON scheduled_posts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_posts_platform ON scheduled_posts(platform);

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connector_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  cost_cents_per_post INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  secret_ciphertext TEXT,
  secret_iv TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connectors_platform ON connectors(platform, enabled, priority);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  post_id TEXT REFERENCES scheduled_posts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  impressions INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  engagements INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  landing_visits INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_post ON metrics(post_id);
CREATE INDEX IF NOT EXISTS idx_metrics_captured ON metrics(captured_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_post_source ON metrics(post_id,source);

CREATE TABLE IF NOT EXISTS sales_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  post_id TEXT REFERENCES scheduled_posts(id) ON DELETE SET NULL,
  tracking_code TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('paid','refunded')),
  amount_cents INTEGER NOT NULL,
  currency TEXT,
  occurred_at TEXT NOT NULL,
  raw_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(provider,transaction_id,product_id,event_type)
);
CREATE INDEX IF NOT EXISTS idx_sales_product ON sales_events(product_id,occurred_at);
CREATE INDEX IF NOT EXISTS idx_sales_post ON sales_events(post_id);

CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  provider TEXT,
  model TEXT,
  purpose TEXT NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  input_summary TEXT,
  output_text TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS cost_usage (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  provider TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  units REAL NOT NULL DEFAULT 0,
  period TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_period ON cost_usage(period);

CREATE TABLE IF NOT EXISTS health_events (
  id TEXT PRIMARY KEY,
  component TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('green','yellow','red')),
  message TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_health_open ON health_events(resolved, severity);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value_json, updated_at) VALUES
('posting_policy', '{"facebook":{"per_day":2,"times":["09:15","18:45"]},"instagram":{"per_day":1,"times":["12:15"]},"tiktok":{"per_day":1,"times":["19:30"]},"pinterest":{"per_day":5,"times":["07:30","10:30","13:30","17:00","20:30"]},"email":{"per_week":1,"times":["10:00"]}}', datetime('now')),
('autopilot', '{"enabled":true,"experimental_share":0.12,"conservative_after_days":14,"max_monthly_cost_cents":0}', datetime('now')),
('optimization', '{"minimum_impressions":300,"minimum_clicks":12,"winner_boost":1.35,"weak_penalty":0.75,"retire_never_automatically":true}', datetime('now')),
('marketing_timezone', '{"iana":"America/Chicago"}', datetime('now')),
('cost_control', '{"approved_monthly_cost_cents":0,"ai_estimated_cents_per_call":1}', datetime('now'));

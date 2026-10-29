-- One row per country: a two-letter code and how many visits came from it.
-- The worker also creates this table by itself on its first request.
CREATE TABLE IF NOT EXISTS visits (
  country TEXT PRIMARY KEY,
  count   INTEGER NOT NULL DEFAULT 0
);

-- Seasonal kingdom sign-ups (POST /signup, src/index.js). One row per member per
-- season: signing up again updates the row.
CREATE TABLE IF NOT EXISTS signups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  season          TEXT NOT NULL,      -- SIGNUP_SEASON, e.g. 'SK7'
  home_clan       TEXT NOT NULL,      -- 'cCc Champions', 'cCc Anatolia', ...
  member_name     TEXT NOT NULL,      -- as on the clan's member list
  member_verified INTEGER NOT NULL,   -- 1: found on the clan's member list when submitted
  participate     INTEGER NOT NULL,   -- 1: yes, 0: no
  sk_clan         TEXT,               -- 'main' | 'academy' (participants only)
  goals           TEXT,               -- JSON array: 'golden_cyanide', 'sk_title', 'fragments', 'new_main_t9', 'new_main_other'
  target_level    TEXT,               -- the level aimed for with 'new_main_other'
  played_before   INTEGER,            -- 1: has played an SK before, 0: first SK
  budget          TEXT,               -- 'not_much' | 'gold_pass' | 'gold_forest' | 'all_passes' | 'passes_hercules' | 'whatever_it_takes'
  start_when      TEXT,               -- 'minute_it_starts' | 'day_it_starts' | 'few_days_later' | 'later_in_season'
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (season, home_clan, member_name)
);

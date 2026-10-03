import type Database from "better-sqlite3";

// Numbered, run-once schema changes. bootstrap.ts creates the original tables;
// everything added since goes here so columns can evolve on the live database.
// Never edit a migration that has shipped: add a new one.

interface Migration {
  id: number;
  name: string;
  up(db: Database.Database): void;
}

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "hub_foundations",
    up(db) {
      db.exec(`
        ALTER TABLE events ADD COLUMN game_id TEXT;

        CREATE TABLE hub_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE scout_sessions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('scout', 'manager', 'strategist', 'lead')),
          signed_in_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          connected INTEGER NOT NULL DEFAULT 0,
          on_break INTEGER NOT NULL DEFAULT 0,
          signed_out_at TEXT
        );
        CREATE INDEX idx_scout_sessions_name ON scout_sessions(name);

        CREATE TABLE change_log (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          event_key TEXT,
          entity TEXT NOT NULL,
          entity_key TEXT NOT NULL,
          op TEXT NOT NULL,
          audience TEXT NOT NULL,
          payload_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_change_log_event ON change_log(event_key, seq);
      `);
    },
  },
  {
    id: 2,
    name: "hub_schedule",
    up(db) {
      db.exec(`
        ALTER TABLE events ADD COLUMN timezone TEXT;
        ALTER TABLE matches ADD COLUMN set_number INTEGER;
        ALTER TABLE matches ADD COLUMN planned_at TEXT;
        ALTER TABLE matches ADD COLUMN predicted_at TEXT;
        ALTER TABLE matches ADD COLUMN actual_at TEXT;
        ALTER TABLE matches ADD COLUMN marked_played INTEGER NOT NULL DEFAULT 0;
        UPDATE matches SET planned_at = scheduled_at WHERE planned_at IS NULL;

        CREATE TABLE event_rankings (
          event_key TEXT NOT NULL,
          team_number INTEGER NOT NULL,
          rank INTEGER NOT NULL,
          ranking_score REAL,
          wins INTEGER,
          losses INTEGER,
          ties INTEGER,
          matches_played INTEGER,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (event_key, team_number)
        );
      `);
    },
  },
  {
    id: 3,
    name: "hub_scouting",
    up(db) {
      db.exec(`
        ALTER TABLE scout_sessions ADD COLUMN scouting INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE scout_sessions ADD COLUMN scout_key TEXT;
        UPDATE scout_sessions SET scouting = 1 WHERE role = 'scout';
        UPDATE scout_sessions SET scout_key = lower(name);
        CREATE INDEX idx_scout_sessions_key ON scout_sessions(scout_key);

        CREATE TABLE match_scout_entries (
          id TEXT PRIMARY KEY,
          event_key TEXT NOT NULL,
          match_key TEXT NOT NULL,
          team_number INTEGER NOT NULL,
          scout TEXT NOT NULL,
          scout_key TEXT NOT NULL,
          game_id TEXT NOT NULL,
          data_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'void')),
          revision INTEGER NOT NULL DEFAULT 1,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          submitted_at TEXT,
          edited_by TEXT,
          UNIQUE (match_key, team_number, scout_key),
          FOREIGN KEY (event_key) REFERENCES events(event_key) ON DELETE CASCADE
        );
        CREATE INDEX idx_entries_event_team ON match_scout_entries(event_key, team_number);
        CREATE INDEX idx_entries_match ON match_scout_entries(match_key);

        CREATE TABLE scout_assignments (
          event_key TEXT NOT NULL,
          match_key TEXT NOT NULL,
          alliance TEXT NOT NULL CHECK (alliance IN ('red', 'blue')),
          station INTEGER NOT NULL,
          team_number INTEGER NOT NULL,
          scout TEXT,
          scout_key TEXT,
          source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manager')),
          locked INTEGER NOT NULL DEFAULT 0,
          assigned_at TEXT NOT NULL,
          PRIMARY KEY (match_key, alliance, station),
          FOREIGN KEY (event_key) REFERENCES events(event_key) ON DELETE CASCADE
        );
        CREATE INDEX idx_assignments_scout ON scout_assignments(event_key, scout_key);

        CREATE TABLE scout_activity (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_key TEXT,
          scout TEXT NOT NULL,
          scout_key TEXT NOT NULL,
          match_key TEXT,
          team_number INTEGER,
          kind TEXT NOT NULL,
          at TEXT NOT NULL
        );
        CREATE INDEX idx_activity_scout ON scout_activity(scout_key, id);
      `);
    },
  },
  {
    id: 4,
    name: "hub_pit",
    up(db) {
      db.exec(`
        CREATE TABLE pit_entries (
          id TEXT PRIMARY KEY,
          event_key TEXT NOT NULL,
          team_number INTEGER NOT NULL,
          scout TEXT NOT NULL,
          scout_key TEXT NOT NULL,
          game_id TEXT NOT NULL,
          data_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'void')),
          revision INTEGER NOT NULL DEFAULT 1,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          submitted_at TEXT,
          UNIQUE (event_key, team_number, scout_key),
          FOREIGN KEY (event_key) REFERENCES events(event_key) ON DELETE CASCADE
        );
        CREATE INDEX idx_pit_event_team ON pit_entries(event_key, team_number);
      `);
    },
  },
  {
    id: 5,
    name: "hub_briefs",
    up(db) {
      db.exec(`
        CREATE TABLE hub_briefs (
          event_key TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('match', 'team', 'event')),
          subject TEXT NOT NULL,
          content_md TEXT NOT NULL,
          data_hash TEXT NOT NULL,
          model TEXT NOT NULL,
          requested_by TEXT,
          generated_at TEXT NOT NULL,
          PRIMARY KEY (event_key, kind, subject)
        );
      `);
    },
  },
  {
    id: 6,
    name: "hub_picks",
    up(db) {
      db.exec(`
        CREATE TABLE pick_list_entries (
          event_key TEXT NOT NULL,
          team_number INTEGER NOT NULL,
          tier TEXT NOT NULL CHECK (tier IN ('first', 'second', 'third', 'avoid')),
          position INTEGER NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          picked INTEGER NOT NULL DEFAULT 0,
          updated_by TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (event_key, team_number),
          FOREIGN KEY (event_key) REFERENCES events(event_key) ON DELETE CASCADE
        );
      `);
    },
  },
];

export function runMigrations(db: Database.Database): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const applied = new Set(
    (db.prepare(`SELECT id FROM schema_migrations`).all() as Array<{ id: number }>).map((r) => r.id)
  );
  const ran: number[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare(`INSERT INTO schema_migrations (id, name) VALUES (?, ?)`).run(migration.id, migration.name);
    })();
    ran.push(migration.id);
  }
  return ran;
}

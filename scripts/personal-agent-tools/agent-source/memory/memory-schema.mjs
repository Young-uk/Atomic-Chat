const MEMORY_SCHEMA_VERSION = 10;
const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_facts (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_facts_updated
  ON profile_facts(updated_at DESC);
`;
const V2_SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  source        TEXT NOT NULL,
  session_id    TEXT,
  working_dir   TEXT,
  tags          TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_working_dir
  ON memories(working_dir);
CREATE INDEX IF NOT EXISTS idx_memories_updated
  ON memories(updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content)
  VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content)
  VALUES ('delete', old.id, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;
`;
const V3_MIGRATION = `
ALTER TABLE profile_facts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 1;
ALTER TABLE profile_facts ADD COLUMN keywords TEXT;
`;
const V4_MIGRATION = `
ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_recalled_at INTEGER;
ALTER TABLE memories ADD COLUMN consolidating_at INTEGER;
`;
const V5_MIGRATION = `
CREATE TABLE memory_embeddings (
  memory_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, model),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX idx_memory_embeddings_model ON memory_embeddings(model);
`;
const V6_MIGRATION = `
CREATE TABLE memory_links (
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, kind),
  FOREIGN KEY (from_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (to_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX idx_memory_links_to ON memory_links(to_id);
CREATE INDEX idx_memory_links_kind ON memory_links(kind);
`;
const V7_MIGRATION = `
ALTER TABLE profile_facts RENAME TO profile_facts_legacy;
CREATE TABLE profile_facts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  pinned          INTEGER NOT NULL DEFAULT 1,
  keywords        TEXT,
  valid_from      INTEGER NOT NULL,
  superseded_by   INTEGER,
  supersedes      INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_profile_active_key
  ON profile_facts(key) WHERE superseded_by IS NULL;
CREATE INDEX idx_profile_chain ON profile_facts(superseded_by);
INSERT INTO profile_facts
  (key, value, pinned, keywords, valid_from, superseded_by, supersedes,
   created_at, updated_at)
  SELECT key,
         value,
         COALESCE(pinned, 1),
         keywords,
         updated_at,
         NULL,
         NULL,
         updated_at,
         updated_at
    FROM profile_facts_legacy;
DROP TABLE profile_facts_legacy;
`;
const V8_MIGRATION = `
ALTER TABLE memories ADD COLUMN consolidated_into INTEGER;
CREATE INDEX idx_memories_consolidated ON memories(consolidated_into);

CREATE TABLE lessons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  activation      TEXT NOT NULL,
  principle       TEXT NOT NULL,
  tags            TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  success_count   INTEGER NOT NULL DEFAULT 0,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  parent_ids      TEXT NOT NULL,
  working_dir     TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deprecated_at   INTEGER
);
CREATE INDEX idx_lessons_status ON lessons(status);
CREATE INDEX idx_lessons_updated_at ON lessons(updated_at);

CREATE VIRTUAL TABLE lessons_fts USING fts5(
  activation, principle, tags,
  content='lessons',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER lessons_ai AFTER INSERT ON lessons BEGIN
  INSERT INTO lessons_fts(rowid, activation, principle, tags)
    VALUES (new.id, new.activation, new.principle, COALESCE(new.tags, ''));
END;
CREATE TRIGGER lessons_ad AFTER DELETE ON lessons BEGIN
  INSERT INTO lessons_fts(lessons_fts, rowid, activation, principle, tags)
    VALUES ('delete', old.id, old.activation, old.principle, COALESCE(old.tags, ''));
END;
CREATE TRIGGER lessons_au AFTER UPDATE ON lessons BEGIN
  INSERT INTO lessons_fts(lessons_fts, rowid, activation, principle, tags)
    VALUES ('delete', old.id, old.activation, old.principle, COALESCE(old.tags, ''));
  INSERT INTO lessons_fts(rowid, activation, principle, tags)
    VALUES (new.id, new.activation, new.principle, COALESCE(new.tags, ''));
END;
`;
const V9_MIGRATION = `
ALTER TABLE memories       ADD COLUMN vote_score REAL NOT NULL DEFAULT 0.0;
ALTER TABLE lessons        ADD COLUMN vote_score REAL NOT NULL DEFAULT 0.0;
ALTER TABLE profile_facts  ADD COLUMN vote_score REAL NOT NULL DEFAULT 0.0;

CREATE INDEX idx_memories_vote_score ON memories(vote_score);
CREATE INDEX idx_lessons_vote_score  ON lessons(vote_score);

CREATE TABLE vote_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  target_id   INTEGER NOT NULL,
  direction   INTEGER NOT NULL,
  session_id  TEXT,
  turn_index  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_vote_events_created ON vote_events(created_at);
CREATE INDEX idx_vote_events_target  ON vote_events(kind, target_id);
`;
const V10_MIGRATION = `
CREATE TABLE procedures (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  activation          TEXT NOT NULL,
  steps               TEXT NOT NULL,
  tags                TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  success_count       INTEGER NOT NULL DEFAULT 0,
  failure_count       INTEGER NOT NULL DEFAULT 0,
  use_count           INTEGER NOT NULL DEFAULT 0,
  vote_score          REAL NOT NULL DEFAULT 0.0,
  parent_lesson_ids   TEXT NOT NULL,
  parent_memory_ids   TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT 'consolidator',
  working_dir         TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deprecated_at       INTEGER
);

CREATE INDEX idx_procedures_status      ON procedures(status);
CREATE INDEX idx_procedures_updated_at  ON procedures(updated_at);
CREATE INDEX idx_procedures_vote_score  ON procedures(vote_score);

CREATE VIRTUAL TABLE procedures_fts USING fts5(
  activation, steps, tags,
  content='procedures',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER procedures_ai AFTER INSERT ON procedures BEGIN
  INSERT INTO procedures_fts(rowid, activation, steps, tags)
    VALUES (new.id, new.activation, new.steps, COALESCE(new.tags, ''));
END;
CREATE TRIGGER procedures_ad AFTER DELETE ON procedures BEGIN
  INSERT INTO procedures_fts(procedures_fts, rowid, activation, steps, tags)
    VALUES ('delete', old.id, old.activation, old.steps, COALESCE(old.tags, ''));
END;
CREATE TRIGGER procedures_au AFTER UPDATE ON procedures BEGIN
  INSERT INTO procedures_fts(procedures_fts, rowid, activation, steps, tags)
    VALUES ('delete', old.id, old.activation, old.steps, COALESCE(old.tags, ''));
  INSERT INTO procedures_fts(rowid, activation, steps, tags)
    VALUES (new.id, new.activation, new.steps, COALESCE(new.tags, ''));
END;
`;
const NAME_GROUNDING_COLUMNS = [
  {
    name: "name_grounding",
    sql: `ALTER TABLE profile_facts ADD COLUMN name_grounding TEXT`
  },
  {
    name: "name_checked_at",
    sql: `ALTER TABLE profile_facts ADD COLUMN name_checked_at INTEGER`
  }
];
function ensureNameGroundingColumns(db) {
  for (const column of NAME_GROUNDING_COLUMNS) {
    const present = db.prepare(
      `SELECT 1 AS present FROM pragma_table_info('profile_facts') WHERE name = ?`
    ).get(column.name);
    if (present) continue;
    try {
      db.exec(column.sql);
    } catch (err) {
      if (!(err instanceof Error) || !/duplicate column/i.test(err.message)) {
        throw err;
      }
    }
  }
}
function applyMigrations(db) {
  db.exec(BASE_SCHEMA);
  const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get();
  const current = row ? Number.parseInt(row.value, 10) : 0;
  if (current > MEMORY_SCHEMA_VERSION) {
    throw new Error(
      `memory.sqlite schema version ${current} is newer than the supported ${MEMORY_SCHEMA_VERSION}; refusing to downgrade`
    );
  }
  if (current < 2) {
    db.exec(V2_SCHEMA);
  }
  if (current < 3) {
    db.exec(V3_MIGRATION);
  }
  if (current < 4) {
    db.exec(V4_MIGRATION);
  }
  if (current < 5) {
    db.exec(V5_MIGRATION);
  }
  if (current < 6) {
    db.exec(V6_MIGRATION);
  }
  if (current < 7) {
    db.exec(V7_MIGRATION);
  }
  if (current < 8) {
    db.exec(V8_MIGRATION);
  }
  if (current < 9) {
    db.exec(V9_MIGRATION);
  }
  if (current < 10) {
    db.exec(V10_MIGRATION);
  }
  ensureNameGroundingColumns(db);
  if (current === MEMORY_SCHEMA_VERSION) return;
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(MEMORY_SCHEMA_VERSION));
}
export {
  MEMORY_SCHEMA_VERSION,
  applyMigrations
};

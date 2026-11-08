import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppDatabase = DatabaseSync;

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

export function createDatabase(dbPath = ':memory:'): AppDatabase {
  if (dbPath !== ':memory:') {
    const resolved = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS actors (
      did TEXT PRIMARY KEY,
      handle TEXT,
      display_name TEXT,
      avatar_url TEXT,
      pds_url TEXT,
      did_doc_json TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_actors_handle ON actors(LOWER(handle));

    CREATE TABLE IF NOT EXISTS follows (
      follower_did TEXT NOT NULL,
      subject_did TEXT NOT NULL,
      PRIMARY KEY (follower_did, subject_did)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_did);

    CREATE TABLE IF NOT EXISTS games (
      uri TEXT PRIMARY KEY,
      publisher_did TEXT NOT NULL,
      rkey TEXT NOT NULL,
      cid TEXT,
      name TEXT NOT NULL,
      tagline TEXT,
      description TEXT,
      url TEXT,
      category TEXT,
      status TEXT,
      icon_url TEXT,
      icon_cid TEXT,
      icon_mime TEXT,
      developer_name TEXT,
      developer_did TEXT,
      raw_json TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_games_publisher ON games(publisher_did);

    CREATE TABLE IF NOT EXISTS achievement_definitions (
      uri TEXT PRIMARY KEY,
      publisher_did TEXT NOT NULL,
      rkey TEXT NOT NULL,
      cid TEXT,
      game_uri TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      requirement TEXT,
      icon_url TEXT,
      icon_cid TEXT,
      icon_mime TEXT,
      icon_alt TEXT,
      locked_icon_cid TEXT,
      locked_icon_mime TEXT,
      tier TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      hidden_space TEXT,
      is_redacted_stub INTEGER NOT NULL DEFAULT 0,
      trusted_issuers_json TEXT,
      steps_needed INTEGER,
      group_name TEXT,
      list_order INTEGER,
      badge_uri TEXT,
      created_at TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ach_defs_game ON achievement_definitions(game_uri);
    CREATE INDEX IF NOT EXISTS idx_ach_defs_publisher ON achievement_definitions(publisher_did);

    CREATE TABLE IF NOT EXISTS leaderboard_definitions (
      uri TEXT PRIMARY KEY,
      publisher_did TEXT NOT NULL,
      rkey TEXT NOT NULL,
      cid TEXT,
      game_uri TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      icon_url TEXT,
      icon_cid TEXT,
      icon_mime TEXT,
      icon_alt TEXT,
      sort_order TEXT NOT NULL,
      score_format_json TEXT NOT NULL,
      components_json TEXT,
      default_component TEXT,
      details_schema TEXT,
      ranked_versions_json TEXT,
      trusted_issuers_json TEXT,
      timeframes_json TEXT NOT NULL,
      record_policy TEXT NOT NULL,
      score_min INTEGER,
      score_max INTEGER,
      list_order INTEGER,
      created_at TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_lb_defs_game ON leaderboard_definitions(game_uri);
    CREATE INDEX IF NOT EXISTS idx_lb_defs_publisher ON leaderboard_definitions(publisher_did);

    CREATE TABLE IF NOT EXISTS achievement_unlocks (
      uri TEXT PRIMARY KEY,
      player_did TEXT NOT NULL,
      rkey TEXT NOT NULL,
      achievement_uri TEXT NOT NULL,
      game_uri TEXT,
      unlocked_at TEXT NOT NULL,
      steps_completed INTEGER,
      verified INTEGER NOT NULL DEFAULT 0,
      verification_error TEXT,
      verification_message TEXT,
      issuer_did TEXT,
      key_id TEXT,
      attestation_cid TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      revocation_reason TEXT,
      label_invalidated INTEGER NOT NULL DEFAULT 0,
      active_labels_json TEXT,
      raw_json TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_unlocks_player ON achievement_unlocks(player_did);
    CREATE INDEX IF NOT EXISTS idx_unlocks_ach ON achievement_unlocks(achievement_uri);
    CREATE INDEX IF NOT EXISTS idx_unlocks_issuer ON achievement_unlocks(issuer_did);
    CREATE INDEX IF NOT EXISTS idx_unlocks_cid ON achievement_unlocks(attestation_cid);

    CREATE TABLE IF NOT EXISTS achievement_progress (
      uri TEXT PRIMARY KEY,
      player_did TEXT NOT NULL,
      rkey TEXT NOT NULL,
      achievement_uri TEXT NOT NULL,
      definition_cid TEXT,
      game_uri TEXT,
      current_steps INTEGER NOT NULL,
      steps_needed INTEGER,
      updated_at TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      attestation_cid TEXT,
      raw_json TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_progress_player ON achievement_progress(player_did);
    CREATE INDEX IF NOT EXISTS idx_progress_ach ON achievement_progress(achievement_uri);

    CREATE TABLE IF NOT EXISTS leaderboard_scores (
      uri TEXT PRIMARY KEY,
      player_did TEXT NOT NULL,
      rkey TEXT NOT NULL,
      leaderboard_uri TEXT NOT NULL,
      game_uri TEXT,
      score INTEGER NOT NULL,
      display_score TEXT,
      components_json TEXT,
      details_json TEXT,
      version TEXT,
      replay_cid TEXT,
      replay_mime TEXT,
      tag TEXT,
      recorded_at TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      verification_error TEXT,
      verification_message TEXT,
      issuer_did TEXT,
      key_id TEXT,
      attestation_cid TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      revocation_reason TEXT,
      label_invalidated INTEGER NOT NULL DEFAULT 0,
      active_labels_json TEXT,
      raw_json TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_scores_lb ON leaderboard_scores(leaderboard_uri);
    CREATE INDEX IF NOT EXISTS idx_scores_player ON leaderboard_scores(player_did);
    CREATE INDEX IF NOT EXISTS idx_scores_issuer ON leaderboard_scores(issuer_did);
    CREATE INDEX IF NOT EXISTS idx_scores_cid ON leaderboard_scores(attestation_cid);

    CREATE TABLE IF NOT EXISTS revocations (
      uri TEXT PRIMARY KEY,
      publisher_did TEXT NOT NULL,
      rkey TEXT NOT NULL,
      scope TEXT NOT NULL,
      attestation_cid TEXT,
      player_did TEXT NOT NULL,
      subject_uri TEXT NOT NULL,
      record_uri TEXT,
      before_ts TEXT,
      reason TEXT NOT NULL,
      note TEXT,
      revoked_at TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_revocations_publisher ON revocations(publisher_did);
    CREATE INDEX IF NOT EXISTS idx_revocations_cid ON revocations(attestation_cid);

    CREATE TABLE IF NOT EXISTS moderation_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      src TEXT NOT NULL,
      uri TEXT NOT NULL,
      cid TEXT NOT NULL DEFAULT '',
      val TEXT NOT NULL,
      neg INTEGER NOT NULL DEFAULT 0,
      cts TEXT NOT NULL,
      exp TEXT,
      indexed_at TEXT NOT NULL,
      UNIQUE(src, uri, cid, val)
    );
    CREATE INDEX IF NOT EXISTS idx_labels_uri ON moderation_labels(uri);
    CREATE INDEX IF NOT EXISTS idx_labels_src ON moderation_labels(src);
  `);

  // Idempotent schema migrations for pre-existing persistent SQLite databases
  ensureColumn(db, 'achievement_definitions', 'hidden_space', 'TEXT');
  ensureColumn(db, 'achievement_definitions', 'is_redacted_stub', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'achievement_definitions', 'trusted_issuers_json', 'TEXT');

  ensureColumn(db, 'leaderboard_definitions', 'components_json', 'TEXT');
  ensureColumn(db, 'leaderboard_definitions', 'default_component', 'TEXT');
  ensureColumn(db, 'leaderboard_definitions', 'details_schema', 'TEXT');
  ensureColumn(db, 'leaderboard_definitions', 'ranked_versions_json', 'TEXT');
  ensureColumn(db, 'leaderboard_definitions', 'trusted_issuers_json', 'TEXT');

  ensureColumn(db, 'achievement_unlocks', 'label_invalidated', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'achievement_unlocks', 'active_labels_json', 'TEXT');

  ensureColumn(db, 'achievement_progress', 'definition_cid', 'TEXT');

  ensureColumn(db, 'leaderboard_scores', 'components_json', 'TEXT');
  ensureColumn(db, 'leaderboard_scores', 'details_json', 'TEXT');
  ensureColumn(db, 'leaderboard_scores', 'version', 'TEXT');
  ensureColumn(db, 'leaderboard_scores', 'replay_cid', 'TEXT');
  ensureColumn(db, 'leaderboard_scores', 'replay_mime', 'TEXT');
  ensureColumn(db, 'leaderboard_scores', 'label_invalidated', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'leaderboard_scores', 'active_labels_json', 'TEXT');

  // Purge any legacy dummy/showcase rows (`is_demo = 1`) from persistent SQLite databases
  db.exec(`
    DELETE FROM follows
    WHERE follower_did IN (SELECT did FROM actors WHERE is_demo = 1)
       OR subject_did IN (SELECT did FROM actors WHERE is_demo = 1);
    DELETE FROM achievement_unlocks WHERE is_demo = 1;
    DELETE FROM achievement_progress WHERE is_demo = 1;
    DELETE FROM leaderboard_scores WHERE is_demo = 1;
    DELETE FROM revocations WHERE is_demo = 1;
    DELETE FROM achievement_definitions WHERE is_demo = 1;
    DELETE FROM leaderboard_definitions WHERE is_demo = 1;
    DELETE FROM games WHERE is_demo = 1;
    DELETE FROM actors WHERE is_demo = 1;
  `);

  return db;
}

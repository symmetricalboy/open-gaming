import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppDatabase = DatabaseSync;

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
  `);

  return db;
}

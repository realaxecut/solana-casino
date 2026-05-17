const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'casino.db');

// Ensure data directory exists
const fs = require('fs');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    wallet       TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    avatar       TEXT,
    total_bet    INTEGER NOT NULL DEFAULT 0,
    total_won    INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id           TEXT PRIMARY KEY,
    wallet       TEXT NOT NULL,
    display_name TEXT NOT NULL,
    message      TEXT NOT NULL,
    is_mod       INTEGER NOT NULL DEFAULT 0,
    avatar       TEXT,
    timestamp    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chat_timestamp ON chat_messages(timestamp DESC);
`);

// ── User queries ─────────────────────────────────────────────────────────────

const stmts = {
  getUser:      db.prepare('SELECT * FROM users WHERE wallet = ?'),
  upsertUser:   db.prepare(`
    INSERT INTO users (wallet, display_name, updated_at)
    VALUES (@wallet, @display_name, @now)
    ON CONFLICT(wallet) DO UPDATE SET
      display_name = excluded.display_name,
      updated_at   = excluded.updated_at
  `),
  setAvatar:    db.prepare('UPDATE users SET avatar = ?, updated_at = ? WHERE wallet = ?'),
  updateStats:  db.prepare(`
    UPDATE users SET
      total_bet    = total_bet + @bet,
      total_won    = total_won + @won,
      games_played = games_played + 1,
      updated_at   = @now
    WHERE wallet = @wallet
  `),
  getUserByName: db.prepare('SELECT wallet FROM users WHERE lower(display_name) = lower(?)'),
  insertChat:   db.prepare(`
    INSERT INTO chat_messages (id, wallet, display_name, message, is_mod, avatar, timestamp)
    VALUES (@id, @wallet, @display_name, @message, @is_mod, @avatar, @timestamp)
  `),
  getChatHistory: db.prepare('SELECT * FROM chat_messages ORDER BY timestamp DESC LIMIT ?'),
  countChat:    db.prepare('SELECT COUNT(*) as cnt FROM chat_messages'),
  deleteOldChat: db.prepare(`
    DELETE FROM chat_messages WHERE id IN (
      SELECT id FROM chat_messages ORDER BY timestamp ASC LIMIT ?
    )
  `),
};

module.exports = { db, stmts };

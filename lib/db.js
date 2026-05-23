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

  CREATE TABLE IF NOT EXISTS referrals (
    referred_wallet  TEXT PRIMARY KEY,
    referrer_wallet  TEXT NOT NULL,
    created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_wallet);

  CREATE TABLE IF NOT EXISTS referral_slugs (
    slug         TEXT PRIMARY KEY,
    wallet       TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS referral_earnings (
    id              TEXT PRIMARY KEY,
    referrer_wallet TEXT NOT NULL,
    referred_wallet TEXT NOT NULL,
    round_id        TEXT NOT NULL,
    win_amount      INTEGER NOT NULL,
    bonus_amount    INTEGER NOT NULL,
    paid_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_refearnings_referrer ON referral_earnings(referrer_wallet);

  CREATE TABLE IF NOT EXISTS pending_referral_earnings (
    id              TEXT PRIMARY KEY,
    referrer_wallet TEXT NOT NULL,
    referred_wallet TEXT NOT NULL,
    round_id        TEXT NOT NULL,
    earning_type    TEXT NOT NULL DEFAULT 'win',
    source_amount   INTEGER NOT NULL,
    bonus_amount    INTEGER NOT NULL,
    claimed         INTEGER NOT NULL DEFAULT 0,
    claim_tx        TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    claimed_at      INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_pending_ref_referrer ON pending_referral_earnings(referrer_wallet);
  CREATE INDEX IF NOT EXISTS idx_pending_ref_round ON pending_referral_earnings(round_id);

  CREATE TABLE IF NOT EXISTS moderators (
    wallet     TEXT PRIMARY KEY,
    added_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS mod_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('referral_payouts_paused', '0');
  INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('mod_fruitroll_always_lose', '0');
  INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('mod_fruitflip_prop_money', '0');
  INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('mod_fruitflip_xp_only', '0');

  CREATE TABLE IF NOT EXISTS daily_crate_cooldowns (
    wallet     TEXT PRIMARY KEY,
    last_opened INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS pending_claims (
    round_id      TEXT PRIMARY KEY,
    winner_wallet TEXT NOT NULL,
    amount        INTEGER NOT NULL,
    claimed       INTEGER NOT NULL DEFAULT 0,
    claim_tx      TEXT,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    claimed_at    INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_claims_wallet ON pending_claims(winner_wallet);

  CREATE TABLE IF NOT EXISTS fruitroll_claims (
    id            TEXT PRIMARY KEY,
    winner_wallet TEXT NOT NULL,
    bet_tx_sig    TEXT NOT NULL UNIQUE,
    bet_lamports  INTEGER NOT NULL,
    payout_lamports INTEGER NOT NULL,
    fruit_count   INTEGER NOT NULL,
    claimed       INTEGER NOT NULL DEFAULT 0,
    claim_tx      TEXT,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    claimed_at    INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_fruitroll_claims_wallet ON fruitroll_claims(winner_wallet);
  CREATE INDEX IF NOT EXISTS idx_fruitroll_claims_bet_tx ON fruitroll_claims(bet_tx_sig);
`);

// ── User queries ─────────────────────────────────────────────────────────────

const stmts = {
  getUser:      db.prepare('SELECT * FROM users WHERE wallet = ?'),
  insertUserIfNew: db.prepare(`
    INSERT OR IGNORE INTO users (wallet, display_name, created_at, updated_at)
    VALUES (@wallet, @display_name, @now, @now)
  `),
  updateDisplayName: db.prepare(`
    UPDATE users SET display_name = @display_name, updated_at = @now WHERE wallet = @wallet
  `),
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
  updateBetOnly: db.prepare(`
    INSERT INTO users (wallet, display_name, total_bet, updated_at)
    VALUES (@wallet, @display_name, @bet, @now)
    ON CONFLICT(wallet) DO UPDATE SET
      total_bet  = total_bet + @bet,
      updated_at = @now
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
  deleteChatById: db.prepare('DELETE FROM chat_messages WHERE id = ?'),
  deleteChatByWallet: db.prepare('DELETE FROM chat_messages WHERE wallet = ?'),
  clearAllChat: db.prepare('DELETE FROM chat_messages'),

  // Referral statements
  setReferral: db.prepare(`
    INSERT OR IGNORE INTO referrals (referred_wallet, referrer_wallet, created_at)
    VALUES (@referred_wallet, @referrer_wallet, @now)
  `),
  getReferrer: db.prepare('SELECT referrer_wallet FROM referrals WHERE referred_wallet = ?'),
  getReferralCount: db.prepare('SELECT COUNT(*) as cnt FROM referrals WHERE referrer_wallet = ?'),
  getReferralList: db.prepare(`
    SELECT r.referred_wallet, u.display_name, r.created_at
    FROM referrals r LEFT JOIN users u ON u.wallet = r.referred_wallet
    WHERE r.referrer_wallet = ?
    ORDER BY r.created_at DESC
  `),
  insertReferralEarning: db.prepare(`
    INSERT INTO referral_earnings (id, referrer_wallet, referred_wallet, round_id, win_amount, bonus_amount, paid_at)
    VALUES (@id, @referrer_wallet, @referred_wallet, @round_id, @win_amount, @bonus_amount, @now)
  `),
  getReferralEarnings: db.prepare(`
    SELECT re.*, u.display_name as referred_name
    FROM referral_earnings re LEFT JOIN users u ON u.wallet = re.referred_wallet
    WHERE re.referrer_wallet = ?
    ORDER BY re.paid_at DESC
    LIMIT 50
  `),
  getTotalReferralEarnings: db.prepare(`
    SELECT COALESCE(SUM(bonus_amount), 0) as total FROM referral_earnings WHERE referrer_wallet = ?
  `),

  // Pending referral earnings (claimable)
  insertPendingReferralEarning: db.prepare(`
    INSERT OR IGNORE INTO pending_referral_earnings (id, referrer_wallet, referred_wallet, round_id, earning_type, source_amount, bonus_amount, created_at)
    VALUES (@id, @referrer_wallet, @referred_wallet, @round_id, @earning_type, @source_amount, @bonus_amount, @now)
  `),
  getPendingReferralEarnings: db.prepare(`
    SELECT pre.*, u.display_name as referred_name
    FROM pending_referral_earnings pre LEFT JOIN users u ON u.wallet = pre.referred_wallet
    WHERE pre.referrer_wallet = ? AND pre.claimed = 0
    ORDER BY pre.created_at DESC
  `),
  getClaimedReferralEarnings: db.prepare(`
    SELECT pre.*, u.display_name as referred_name
    FROM pending_referral_earnings pre LEFT JOIN users u ON u.wallet = pre.referred_wallet
    WHERE pre.referrer_wallet = ? AND pre.claimed = 1
    ORDER BY pre.claimed_at DESC
    LIMIT 50
  `),
  getTotalUnclaimedReferral: db.prepare(`
    SELECT COALESCE(SUM(bonus_amount), 0) as total FROM pending_referral_earnings WHERE referrer_wallet = ? AND claimed = 0
  `),
  getTotalClaimedReferral: db.prepare(`
    SELECT COALESCE(SUM(bonus_amount), 0) as total FROM pending_referral_earnings WHERE referrer_wallet = ? AND claimed = 1
  `),
  markReferralEarningClaimed: db.prepare(`
    UPDATE pending_referral_earnings
    SET claimed = 1, claim_tx = @claim_tx, claimed_at = @now
    WHERE referrer_wallet = @referrer_wallet AND claimed = 0
  `),
  rollbackReferralClaims: db.prepare(`
    UPDATE pending_referral_earnings
    SET claimed = 0, claim_tx = NULL, claimed_at = NULL
    WHERE referrer_wallet = ? AND claimed = 1 AND claim_tx = 'PENDING'
  `),

  // Mod settings
  getModSetting: db.prepare('SELECT value FROM mod_settings WHERE key = ?'),
  setModSetting: db.prepare(`
    INSERT INTO mod_settings (key, value, updated_at) VALUES (@key, @value, @now)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),

  // Moderators (persisted list)
  getAllModerators:    db.prepare('SELECT wallet FROM moderators'),
  insertModerator:    db.prepare('INSERT OR IGNORE INTO moderators (wallet) VALUES (?)'),
  deleteModerator:    db.prepare('DELETE FROM moderators WHERE wallet = ?'),

  // Daily crate cooldown (server-authoritative)
  getCrateCooldown: db.prepare('SELECT last_opened FROM daily_crate_cooldowns WHERE wallet = ?'),
  setCrateCooldown: db.prepare(`
    INSERT INTO daily_crate_cooldowns (wallet, last_opened, updated_at) VALUES (@wallet, @last_opened, @now)
    ON CONFLICT(wallet) DO UPDATE SET last_opened = excluded.last_opened, updated_at = excluded.updated_at
  `),

  // Slug statements
  setSlug: db.prepare(`
    INSERT INTO referral_slugs (slug, wallet, created_at) VALUES (@slug, @wallet, @now)
    ON CONFLICT(wallet) DO UPDATE SET slug = excluded.slug
  `),
  getSlugByWallet: db.prepare('SELECT slug FROM referral_slugs WHERE wallet = ?'),
  getWalletBySlug: db.prepare('SELECT wallet FROM referral_slugs WHERE slug = ?'),
  slugExists: db.prepare('SELECT 1 FROM referral_slugs WHERE slug = ?'),

  // Pending claims — one row per round, claimed flag is the lock
  insertPendingClaim: db.prepare(`
    INSERT OR IGNORE INTO pending_claims (round_id, winner_wallet, amount, claimed, created_at)
    VALUES (@round_id, @winner_wallet, @amount, 0, @now)
  `),
  getPendingClaim: db.prepare('SELECT * FROM pending_claims WHERE round_id = ?'),
  // Atomically mark as claimed only if still unclaimed — returns changes count
  markClaimed: db.prepare(`
    UPDATE pending_claims
    SET claimed = 1, claim_tx = @claim_tx, claimed_at = @now
    WHERE round_id = @round_id AND claimed = 0
  `),

  // ── Orangepot unclaimed wins (for recovery banner) ────────────────────────
  getUnclaimedOrangepot: db.prepare(`
    SELECT round_id as id, winner_wallet, amount, created_at, 'orangepot' as game_type
    FROM pending_claims
    WHERE winner_wallet = ? AND claimed = 0
    ORDER BY created_at DESC
  `),

  // ── FruitRoll claim statements ────────────────────────────────────────────
  insertFruitrollClaim: db.prepare(`
    INSERT OR IGNORE INTO fruitroll_claims (id, winner_wallet, bet_tx_sig, bet_lamports, payout_lamports, fruit_count, claimed, created_at)
    VALUES (@id, @winner_wallet, @bet_tx_sig, @bet_lamports, @payout_lamports, @fruit_count, 0, @now)
  `),
  getFruitrollClaimById: db.prepare('SELECT * FROM fruitroll_claims WHERE id = ?'),
  getFruitrollClaimByTx: db.prepare('SELECT * FROM fruitroll_claims WHERE bet_tx_sig = ?'),
  markFruitrollClaimed: db.prepare(`
    UPDATE fruitroll_claims
    SET claimed = 1, claim_tx = @claim_tx, claimed_at = @now
    WHERE id = @id AND claimed = 0
  `),
  rollbackFruitrollClaim: db.prepare(`
    UPDATE fruitroll_claims SET claimed = 0, claim_tx = NULL, claimed_at = NULL WHERE id = ?
  `),
  getUnclaimedFruitroll: db.prepare(`
    SELECT id, winner_wallet, payout_lamports as amount, created_at, 'fruitroll' as game_type, fruit_count
    FROM fruitroll_claims
    WHERE winner_wallet = ? AND claimed = 0
    ORDER BY created_at DESC
  `),
};

module.exports = { db, stmts };

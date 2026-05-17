const { v4: uuidv4 } = require('uuid');
const { db, stmts } = require('./db.js');
const { getLevel } = require('./levels.js');

const rounds = new Map();
const users = new Map();           // wallet -> user object
const chatCooldowns = new Map();    // wallet -> last message timestamp
const MODERATORS = new Set([
  '9QeT88EePX6w7DsTWe5Tpx9s5go6QfxrUtpxtFeznfxi',
]);
const CHAT_COOLDOWN_MS = 3000;
const usernameIndex = new Map();   // lowercased username -> wallet
const chatHistory = [];
const recentRounds = [];           // last 20 completed rounds, server-side
const mutedWallets = new Set();    // wallets muted by moderators
let currentRoundId = null;

const HOUSE_FEE = 0.05;
const COUNTDOWN_SECONDS = 60;
const MIN_BET_LAMPORTS = 100_000;
const MAX_RECENT_ROUNDS = 20;
const MAX_CHAT_HISTORY = 200;

const PLAYER_COLORS = [
  '#FF6B35', '#FF9F1C', '#FFBF69', '#F7B731', '#FD9644',
  '#FC5C65', '#45AAF2', '#26DE81', '#A55EEA', '#FD79A8',
  '#FDCB6E', '#6C5CE7', '#00B894', '#E17055', '#74B9FF',
  '#55EFC4', '#FAB1A0', '#81ECEC', '#DFE6E9', '#B2BEC3',
];

function getColorForPlayer(index) {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

function recalcPercentages(round) {
  if (round.totalPot === 0) return;
  round.players.forEach(p => {
    p.percentage = (p.betAmount / round.totalPot) * 100;
  });
}

function getCurrentRound() {
  if (!currentRoundId) return null;
  return rounds.get(currentRoundId) || null;
}

function getOrCreateActiveRound() {
  let round = getCurrentRound();
  if (!round || round.status === 'ended') {
    const id = uuidv4();
    round = {
      id, status: 'waiting', players: [], totalPot: 0,
      winnerWallet: null, winnerDisplayName: null, winnerShare: 0,
      startedAt: null, endedAt: null, spinStartAt: null, countdownEndsAt: null,
    };
    rounds.set(id, round);
    currentRoundId = id;
  }
  return round;
}

function placeBet(wallet, displayName, amountLamports) {
  if (amountLamports < MIN_BET_LAMPORTS) return { success: false, error: 'Minimum bet is 0.01 SOL' };
  const round = getOrCreateActiveRound();
  if (round.status === 'spinning' || round.status === 'ended') return { success: false, error: 'Round is not accepting bets' };

  const existingIdx = round.players.findIndex(p => p.wallet === wallet);
  if (existingIdx >= 0) {
    round.players[existingIdx].betAmount += amountLamports;
    round.players[existingIdx].displayName = displayName;
  } else {
    round.players.push({ wallet, displayName, betAmount: amountLamports, percentage: 0, color: getColorForPlayer(round.players.length), joinedAt: Date.now() });
  }

  round.totalPot += amountLamports;
  recalcPercentages(round);

  // Track wagered SOL in the DB — upserts so it works even if user not yet registered
  stmts.updateBetOnly.run({ wallet, display_name: displayName || wallet.slice(0, 8), bet: amountLamports, now: Date.now() });
  const updatedRow = stmts.getUser.get(wallet);
  if (updatedRow) users.set(wallet, dbRowToUser(updatedRow));

  if (round.players.length === 2 && round.status === 'waiting') {
    round.status = 'active';
    round.startedAt = Date.now();
    round.countdownEndsAt = Date.now() + COUNTDOWN_SECONDS * 1000;
  }

  return { success: true, round };
}

function spinRound(roundId) {
  const round = rounds.get(roundId);
  if (!round || round.status !== 'active') return null;
  round.status = 'spinning';
  round.spinStartAt = Date.now();

  let rand = Math.random() * round.totalPot;
  let winner = round.players[0];
  for (const p of round.players) {
    rand -= p.betAmount;
    if (rand <= 0) { winner = p; break; }
  }

  const fee = Math.floor(round.totalPot * HOUSE_FEE);
  round.winnerWallet = winner.wallet;
  round.winnerDisplayName = winner.displayName;
  round.winnerShare = round.totalPot - fee;
  return round;
}

function endRound(roundId) {
  const round = rounds.get(roundId);
  if (!round) return null;
  round.status = 'ended';
  round.endedAt = Date.now();

  // Record in server-side recent rounds history
  if (round.winnerWallet) {
    const winnerPlayer = round.players.find(p => p.wallet === round.winnerWallet);
    const winnerChance = winnerPlayer ? winnerPlayer.percentage : 0;
    recentRounds.unshift({
      id: round.id,
      winnerDisplayName: round.winnerDisplayName,
      winnerWallet: round.winnerWallet,
      winnerShare: round.winnerShare,
      totalPot: round.totalPot,
      winnerChance,
      playerCount: round.players.length,
      endedAt: round.endedAt,
    });
    if (recentRounds.length > MAX_RECENT_ROUNDS) recentRounds.splice(MAX_RECENT_ROUNDS);
  }

  currentRoundId = null;
  getOrCreateActiveRound();
  return round;
}

function getRecentRounds() {
  return recentRounds.slice();
}

// ── Username management ────────────────────────────────────────────────────

function isUsernameTaken(name, excludeWallet) {
  const key = name.trim().toLowerCase();
  const owner = usernameIndex.get(key);
  if (!owner) return false;
  if (excludeWallet && owner === excludeWallet) return false;
  return true;
}

function upsertUser(wallet, displayName) {
  const trimmed = (displayName || wallet.slice(0, 8)).trim();
  // Use INSERT OR IGNORE so we never overwrite total_bet/total_won on reconnect
  stmts.insertUserIfNew.run({ wallet, display_name: trimmed, now: Date.now() });
  // Always update display_name in case it changed, but never touch stats
  stmts.updateDisplayName.run({ display_name: trimmed, now: Date.now(), wallet });
  const row = stmts.getUser.get(wallet);
  const user = dbRowToUser(row);
  users.set(wallet, user);
  usernameIndex.set(trimmed.toLowerCase(), wallet);
  return user;
}

function dbRowToUser(row) {
  if (!row) return null;
  return {
    wallet: row.wallet,
    displayName: row.display_name,
    avatar: row.avatar || null,
    totalBet: row.total_bet,
    totalWon: row.total_won,
    gamesPlayed: row.games_played,
    createdAt: row.created_at,
    level: getLevel(row.total_bet),
  };
}

function recordWin(wallet, wonLamports) {
  stmts.updateStats.run({ bet: 0, won: wonLamports, now: Date.now(), wallet });
  const row = stmts.getUser.get(wallet);
  if (row) users.set(wallet, dbRowToUser(row));
}

function getUser(wallet) {
  // Always read from DB so total_bet (wagered SOL / level) is never stale
  const row = stmts.getUser.get(wallet);
  if (!row) return null;
  const user = dbRowToUser(row);
  users.set(wallet, user);
  return user;
}

function changeUsername(wallet, newName) {
  const trimmed = newName.trim();
  if (!trimmed || trimmed.length < 2) return { success: false, error: 'Username must be at least 2 characters' };
  if (trimmed.length > 20) return { success: false, error: 'Username must be 20 characters or less' };
  if (!/^[a-zA-Z0-9_\-. ]+$/.test(trimmed)) return { success: false, error: 'Only letters, numbers, spaces, _ - . allowed' };
  if (isUsernameTaken(trimmed, wallet)) return { success: false, error: 'Username already taken' };
  const user = upsertUser(wallet, trimmed);
  return { success: true, user };
}

// ── Avatar ─────────────────────────────────────────────────────────────────

function setAvatar(wallet, avatarDataUrl) {
  if (avatarDataUrl && avatarDataUrl.length > 2800000) return { error: 'Image too large' };
  // Auto-create user row if it doesn't exist yet
  stmts.insertUserIfNew.run({ wallet, display_name: wallet.slice(0, 8), now: Date.now() });
  stmts.setAvatar.run(avatarDataUrl || null, Date.now(), wallet);
  // Update memory cache
  if (users.has(wallet)) users.get(wallet).avatar = avatarDataUrl || null;
  return { success: true };
}

function getAvatar(wallet) {
  const row = stmts.getUser.get(wallet);
  return row?.avatar || null;
}

// ── Chat ───────────────────────────────────────────────────────────────────

function addChatMessage(wallet, displayName, message) {
  const now = Date.now();
  const last = chatCooldowns.get(wallet) || 0;
  if (now - last < CHAT_COOLDOWN_MS) {
    return { error: 'cooldown', msLeft: CHAT_COOLDOWN_MS - (now - last) };
  }
  // Reject muted users
  if (mutedWallets.has(wallet)) {
    return { error: 'cooldown', msLeft: CHAT_COOLDOWN_MS }; // silent for muted
  }
  chatCooldowns.set(wallet, now);
  const isMod = MODERATORS.has(wallet);
  const avatar = getAvatar(wallet);
  const userRow = stmts.getUser.get(wallet);
  const level = userRow ? getLevel(userRow.total_bet) : getLevel(0);
  const msg = { id: uuidv4(), wallet, displayName, message: message.slice(0, 280), timestamp: now, isMod, avatar, level };
  // Persist to DB
  stmts.insertChat.run({ id: msg.id, wallet, display_name: displayName, message: msg.message, is_mod: isMod ? 1 : 0, avatar, timestamp: now });
  // Trim old messages if over limit
  const { cnt } = stmts.countChat.get();
  if (cnt > MAX_CHAT_HISTORY) stmts.deleteOldChat.run(cnt - MAX_CHAT_HISTORY);
  // Keep in-memory cache
  chatHistory.push(msg);
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.splice(0, chatHistory.length - MAX_CHAT_HISTORY);
  return msg;
}

function getChatHistory(limit = 50) {
  // Always load fresh from DB so history survives restarts
  const rows = stmts.getChatHistory.all(limit).reverse();
  return rows.map(r => ({
    id: r.id, wallet: r.wallet, displayName: r.display_name,
    message: r.message, timestamp: r.timestamp,
    isMod: r.is_mod === 1, avatar: r.avatar || null,
  }));
}

// ── Moderation ─────────────────────────────────────────────────────────────

function isModerator(wallet) {
  return MODERATORS.has(wallet);
}

function muteUser(wallet) {
  mutedWallets.add(wallet);
}

function deleteMessage(messageId) {
  const idx = chatHistory.findIndex(m => m.id === messageId);
  if (idx >= 0) chatHistory.splice(idx, 1);
  // Remove from DB
  stmts.deleteChatById?.run(messageId);
}

function deleteChatByWallet(wallet) {
  // Remove from in-memory cache
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].wallet === wallet) chatHistory.splice(i, 1);
  }
  // Remove from DB
  stmts.deleteChatByWallet?.run(wallet);
}

module.exports = {
  getCurrentRound, getOrCreateActiveRound,
  placeBet, spinRound, endRound,
  getRecentRounds,
  upsertUser, getUser, changeUsername, isUsernameTaken,
  setAvatar, getAvatar,
  recordWin,
  addChatMessage, getChatHistory,
  isModerator, muteUser, deleteMessage, deleteChatByWallet,
};

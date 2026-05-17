const { v4: uuidv4 } = require('uuid');

const rounds = new Map();
const users = new Map();           // wallet -> user object
const usernameIndex = new Map();   // lowercased username -> wallet
const chatHistory = [];
const recentRounds = [];           // last 20 completed rounds, server-side
let currentRoundId = null;

const HOUSE_FEE = 0.05;
const COUNTDOWN_SECONDS = 60;
const MIN_BET_LAMPORTS = 10_000_000;
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
  const existing = users.get(wallet);

  // Remove old username from index if changed
  if (existing && existing.displayName) {
    const oldKey = existing.displayName.toLowerCase();
    if (usernameIndex.get(oldKey) === wallet) usernameIndex.delete(oldKey);
  }

  if (existing) {
    existing.displayName = trimmed;
    usernameIndex.set(trimmed.toLowerCase(), wallet);
    return existing;
  }

  const user = { wallet, displayName: trimmed, createdAt: Date.now(), totalWon: 0, totalBet: 0, gamesPlayed: 0 };
  users.set(wallet, user);
  usernameIndex.set(trimmed.toLowerCase(), wallet);
  return user;
}

function getUser(wallet) {
  return users.get(wallet) || null;
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

// ── Chat ───────────────────────────────────────────────────────────────────

function addChatMessage(wallet, displayName, message) {
  const msg = { id: uuidv4(), wallet, displayName, message: message.slice(0, 280), timestamp: Date.now() };
  chatHistory.push(msg);
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.splice(0, chatHistory.length - MAX_CHAT_HISTORY);
  return msg;
}

function getChatHistory(limit = 50) { return chatHistory.slice(-limit); }

module.exports = {
  getCurrentRound, getOrCreateActiveRound,
  placeBet, spinRound, endRound,
  getRecentRounds,
  upsertUser, getUser, changeUsername, isUsernameTaken,
  addChatMessage, getChatHistory,
};

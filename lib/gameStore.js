const { v4: uuidv4 } = require('uuid');

const rounds = new Map();
const users = new Map();
const chatHistory = [];
let currentRoundId = null;

const HOUSE_FEE = 0.05;
const COUNTDOWN_SECONDS = 60;
const MIN_BET_LAMPORTS = 10_000_000;

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
  currentRoundId = null;
  getOrCreateActiveRound();
  return round;
}

function upsertUser(wallet, displayName) {
  const existing = users.get(wallet);
  if (existing) { existing.displayName = displayName; return existing; }
  const user = { wallet, displayName, createdAt: Date.now(), totalWon: 0, totalBet: 0, gamesPlayed: 0 };
  users.set(wallet, user);
  return user;
}

function addChatMessage(wallet, displayName, message) {
  const msg = { id: uuidv4(), wallet, displayName, message: message.slice(0, 280), timestamp: Date.now() };
  chatHistory.push(msg);
  if (chatHistory.length > 200) chatHistory.splice(0, chatHistory.length - 200);
  return msg;
}

function getChatHistory(limit = 50) { return chatHistory.slice(-limit); }

module.exports = { getCurrentRound, getOrCreateActiveRound, placeBet, spinRound, endRound, upsertUser, addChatMessage, getChatHistory };

import { v4 as uuidv4 } from 'uuid';

export interface Player {
  wallet: string;
  displayName: string;
  betAmount: number;
  percentage: number;
  color: string;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  wallet: string;
  displayName: string;
  message: string;
  timestamp: number;
}

export interface GameRound {
  id: string;
  status: 'waiting' | 'active' | 'spinning' | 'ended';
  players: Player[];
  totalPot: number;
  winnerWallet: string | null;
  winnerDisplayName: string | null;
  winnerShare: number;
  startedAt: number | null;
  endedAt: number | null;
  spinStartAt: number | null;
  countdownEndsAt: number | null;
}

export interface UserAccount {
  wallet: string;
  displayName: string;
  createdAt: number;
  totalWon: number;
  totalBet: number;
  gamesPlayed: number;
}

const rounds: Map<string, GameRound> = new Map();
const users: Map<string, UserAccount> = new Map();
const chatHistory: ChatMessage[] = [];
let currentRoundId: string | null = null;

const HOUSE_FEE = 0.05;
export const COUNTDOWN_SECONDS = 60; // 60 second countdown
const MIN_BET_LAMPORTS = 10_000_000;

const PLAYER_COLORS = [
  '#FF6B35', '#FF9F1C', '#FFBF69', '#F7B731', '#FD9644',
  '#FC5C65', '#45AAF2', '#26DE81', '#A55EEA', '#FD79A8',
  '#FDCB6E', '#6C5CE7', '#00B894', '#E17055', '#74B9FF',
  '#55EFC4', '#FAB1A0', '#81ECEC', '#DFE6E9', '#B2BEC3',
];

function getColorForPlayer(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

function recalcPercentages(round: GameRound) {
  if (round.totalPot === 0) return;
  round.players.forEach(p => {
    p.percentage = (p.betAmount / round.totalPot) * 100;
  });
}

export function getCurrentRound(): GameRound | null {
  if (!currentRoundId) return null;
  return rounds.get(currentRoundId) || null;
}

export function getOrCreateActiveRound(): GameRound {
  let round = getCurrentRound();
  if (!round || round.status === 'ended') {
    const id = uuidv4();
    round = {
      id,
      status: 'waiting',
      players: [],
      totalPot: 0,
      winnerWallet: null,
      winnerDisplayName: null,
      winnerShare: 0,
      startedAt: null,
      endedAt: null,
      spinStartAt: null,
      countdownEndsAt: null,
    };
    rounds.set(id, round);
    currentRoundId = id;
  }
  return round;
}

export function placeBet(
  wallet: string,
  displayName: string,
  amountLamports: number
): { success: boolean; error?: string; round?: GameRound } {
  if (amountLamports < MIN_BET_LAMPORTS) {
    return { success: false, error: 'Minimum bet is 0.01 SOL' };
  }

  const round = getOrCreateActiveRound();

  if (round.status === 'spinning' || round.status === 'ended') {
    return { success: false, error: 'Round is not accepting bets' };
  }

  const existingIdx = round.players.findIndex(p => p.wallet === wallet);

  if (existingIdx >= 0) {
    round.players[existingIdx].betAmount += amountLamports;
    round.players[existingIdx].displayName = displayName;
  } else {
    const colorIndex = round.players.length;
    round.players.push({
      wallet,
      displayName,
      betAmount: amountLamports,
      percentage: 0,
      color: getColorForPlayer(colorIndex),
      joinedAt: Date.now(),
    });
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

export function spinRound(roundId: string): GameRound | null {
  const round = rounds.get(roundId);
  if (!round || round.status !== 'active') return null;

  round.status = 'spinning';
  round.spinStartAt = Date.now();

  const totalPot = round.totalPot;
  let rand = Math.random() * totalPot;
  let winner = round.players[0];
  for (const p of round.players) {
    rand -= p.betAmount;
    if (rand <= 0) {
      winner = p;
      break;
    }
  }

  const fee = Math.floor(totalPot * HOUSE_FEE);
  const payout = totalPot - fee;

  round.winnerWallet = winner.wallet;
  round.winnerDisplayName = winner.displayName;
  round.winnerShare = payout;

  round.players.forEach(p => {
    const user = users.get(p.wallet);
    if (user) {
      user.totalBet += p.betAmount;
      user.gamesPlayed += 1;
      if (p.wallet === winner.wallet) {
        user.totalWon += payout;
      }
    }
  });

  return round;
}

export function endRound(roundId: string): GameRound | null {
  const round = rounds.get(roundId);
  if (!round) return null;
  round.status = 'ended';
  round.endedAt = Date.now();
  currentRoundId = null;
  getOrCreateActiveRound();
  return round;
}

export function getUser(wallet: string): UserAccount | null {
  return users.get(wallet) || null;
}

export function upsertUser(wallet: string, displayName: string): UserAccount {
  const existing = users.get(wallet);
  if (existing) {
    existing.displayName = displayName;
    return existing;
  }
  const user: UserAccount = {
    wallet,
    displayName,
    createdAt: Date.now(),
    totalWon: 0,
    totalBet: 0,
    gamesPlayed: 0,
  };
  users.set(wallet, user);
  return user;
}

export function addChatMessage(wallet: string, displayName: string, message: string): ChatMessage {
  const msg: ChatMessage = {
    id: uuidv4(),
    wallet,
    displayName,
    message: message.slice(0, 280),
    timestamp: Date.now(),
  };
  chatHistory.push(msg);
  if (chatHistory.length > 200) chatHistory.splice(0, chatHistory.length - 200);
  return msg;
}

export function getChatHistory(limit = 50): ChatMessage[] {
  return chatHistory.slice(-limit);
}

export function getMinBetSol(): number {
  return MIN_BET_LAMPORTS / 1_000_000_000;
}

export { HOUSE_FEE, MIN_BET_LAMPORTS };

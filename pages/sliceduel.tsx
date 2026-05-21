import React, { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import { io, Socket } from 'socket.io-client';
import SettingsModal from '../components/SettingsModal';

const HOUSE_WALLET = process.env.NEXT_PUBLIC_HOUSE_WALLET || '';
const HOUSE_FEE = 0.05;

// ── Fruit definitions ────────────────────────────────────────────────────────
const FRUITS = [
  { emoji: '🍉', name: 'Watermelon', color: '#48bb78', juiceColor: 'rgba(72,187,120,0.8)',  points: 1 },
  { emoji: '🍊', name: 'Orange',     color: '#ff8c00', juiceColor: 'rgba(255,140,0,0.8)',   points: 2 },
  { emoji: '🍋', name: 'Lemon',      color: '#f6e05e', juiceColor: 'rgba(246,224,94,0.8)',  points: 2 },
  { emoji: '🍇', name: 'Grape',      color: '#9f7aea', juiceColor: 'rgba(159,122,234,0.8)', points: 3 },
  { emoji: '🍒', name: 'Cherry',     color: '#fc8181', juiceColor: 'rgba(252,129,129,0.8)', points: 3 },
  { emoji: '🍍', name: 'Pineapple',  color: '#f59e0b', juiceColor: 'rgba(245,158,11,0.8)', points: 4 },
  { emoji: '🍓', name: 'Strawberry', color: '#e53e3e', juiceColor: 'rgba(229,62,62,0.8)',  points: 4 },
];
const BOMB_COLOR = '#1a1a2e';

// ── Types ────────────────────────────────────────────────────────────────────
interface Fruit {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  rotation: number;
  rotSpeed: number;
  radius: number;
  fruitIdx: number;           // -1 = bomb, -3 = multiplier
  sliced: boolean;
  sliceAngle: number;
  halfOffset: number;
  halfOffsetSpeed: number;
  opacity: number;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;               // 0–1
  decay: number;
  radius: number;
  color: string;
}

interface TrailPoint {
  x: number; y: number;
  t: number; // timestamp ms
}

interface ScorePopup {
  id: number;
  x: number; y: number;
  text: string;
  color: string;
  vy: number;
  life: number;
}

interface Lobby {
  id: string;
  creatorWallet: string;
  creatorName: string;
  wagerLamports: number;
  createdAt: number;
  status: 'open' | 'matched' | 'playing' | 'ended';
  opponentWallet?: string;
  opponentName?: string;
  isTestCash?: boolean;
}

type Phase = 'lobby' | 'countdown' | 'playing' | 'result';

const GAME_DURATION = 60; // seconds
const QUICK_AMOUNTS = ['0.01', '0.1', '0.5', '1'];
const GRAVITY = 0.62;        // px/frame²
const TRAIL_FADE_MS = 140;   // how long trail points live
const TRAIL_MAX = 28;

// ── Seeded PRNG (mulberry32) ─────────────────────────────────────────────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Segment–circle intersection ──────────────────────────────────────────────
function segmentCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(ax - cx, ay - cy) < r;
  const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2));
  const px = ax + t * dx, py = ay + t * dy;
  return Math.hypot(px - cx, py - cy) < r;
}

// ── Power-up definitions ────────────────────────────────────────────────────
const POWERUPS = [
  { type: 'multiplier', emoji: '2️⃣✖️', color: '#fbbf24', label: '2× POINTS!', duration: 5000 },
] as const;
type PowerupType = typeof POWERUPS[number]['type'];

// ── Main Component ───────────────────────────────────────────────────────────
export default function SliceDuel() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();
  const wallet = publicKey?.toBase58() || null;

  // ── Lobby state ──────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('lobby');
  const [wagerInput, setWagerInput] = useState('');
  const [openLobbies, setOpenLobbies] = useState<Lobby[]>([]);
  const [myLobby, setMyLobby] = useState<Lobby | null>(null);
  const [matchedLobby, setMatchedLobby] = useState<Lobby | null>(null);
  const [betError, setBetError] = useState('');
  const [betLoading, setBetLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState<string | null>(null);
  const [lobbyCountdown, setLobbyCountdown] = useState(300);

  // ── Game HUD state (minimal — canvas handles visuals) ────────────────────
  const [countdown, setCountdown] = useState(3);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [score, setScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [combo, setCombo] = useState(0);

  // ── Result state ─────────────────────────────────────────────────────────
  const [playerWon, setPlayerWon] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [finalOpponentScore, setFinalOpponentScore] = useState(0);
  const [payoutAmount, setPayoutAmount] = useState(0);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<'registering' | 'ready' | 'claiming' | 'success' | 'error' | null>(null);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [claimError, setClaimError] = useState('');
  const claimInFlight = useRef(false);

  // ── Misc ─────────────────────────────────────────────────────────────────
  const [socket, setSocket] = useState<Socket | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [unclaimedTotal, setUnclaimedTotal] = useState(0);
  const [isGameLocked, setIsGameLocked] = useState(false);
  // Only received as true by mods — server gatekeeps the mod_fruitroll_flags event
  const [sliceDuelTestCash, setSliceDuelTestCash] = useState(false);

  // ── Canvas & game refs ───────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fruitsRef = useRef<Fruit[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const trailRef = useRef<TrailPoint[]>([]);
  const scorePopupsRef = useRef<ScorePopup[]>([]);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const comboTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextIdRef = useRef(0);
  const popupIdRef = useRef(0);
  const seedRngRef = useRef<(() => number) | null>(null);
  const rafRef = useRef<number | null>(null);
  const spawnTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const betTxSigRef = useRef<string | null>(null);
  const matchIdRef = useRef<string | null>(null);
  const wagerLamportsRef = useRef(0);
  const lobbyCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const walletRef = useRef<string | null>(null);
  const isSlicingRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const phaseRef = useRef<Phase>('lobby');

  // Active power-up state (refs so RAF loop can read without stale closures)
  const multiplierUntilRef = useRef<number>(0);  // when 2× expires
  const [activePowerup, setActivePowerup] = useState<{ type: PowerupType; expiresAt: number } | null>(null);

  // ── Independent game timer using performance.now() ───────────────────────
  // Each client runs its own wall-clock timer — NOT synced via socket.
  const gameStartTimeRef = useRef<number>(0);
  const timeLeftRef = useRef(GAME_DURATION);

  // Emoji rendering cache (pre-render to offscreen canvas for perf)
  const emojiCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  // Background gradient cache — recreate only on resize
  const bgGradientRef = useRef<{ grad: CanvasGradient; w: number; h: number } | null>(null);
  // Juice stains that persist on the wall
  const stainsRef = useRef<{ x: number; y: number; r: number; color: string; alpha: number; blobs: { dx: number; dy: number; r: number }[]; drops: { dx: number; dy: number; r: number; angle: number; stretch: number }[]; spawnedAt: number }[]>([]);

  useEffect(() => { walletRef.current = wallet; }, [wallet]);
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Pre-render emoji to offscreen canvas
  const getEmojiCanvas = useCallback((emoji: string, size: number): HTMLCanvasElement => {
    const key = `${emoji}_${size}`;
    if (emojiCacheRef.current.has(key)) return emojiCacheRef.current.get(key)!;
    const c = document.createElement('canvas');
    c.width = size * 2; c.height = size * 2;
    const ctx = c.getContext('2d')!;
    ctx.font = `${size * 1.6}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size, size);
    emojiCacheRef.current.set(key, c);
    return c;
  }, []);

  // ── Socket setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    const s = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'https://fruitbowl.fun', {
      transports: ['websocket', 'polling'],
    });

    s.on('locked_games', (games: string[]) => setIsGameLocked(games.includes('sliceduel')));
    s.on('mod_fruitroll_flags', (flags: any) => setSliceDuelTestCash(!!flags.sliceDuelTestCash));
    s.on('unclaimed_wins', (data: { totalLamports: number }) => setUnclaimedTotal(data.totalLamports || 0));
    s.on('sliceduel_lobbies', (lobbies: Lobby[]) => {
      setOpenLobbies(lobbies.filter(l => l.status === 'open' && l.creatorWallet !== walletRef.current));
    });
    s.on('sliceduel_lobby_created', (lobby: Lobby) => {
      setMyLobby(lobby);
      startLobbyCountdown();
    });
    s.on('sliceduel_match_found', (data: { lobby: Lobby; seed: number; matchId: string }) => {
      matchIdRef.current = data.matchId;
      seedRngRef.current = mulberry32(data.seed);
      setMatchedLobby(data.lobby);
      setMyLobby(null);
      clearLobbyCountdown();
      startCountdown();
    });
    s.on('sliceduel_opponent_score', (data: { score: number }) => setOpponentScore(data.score));
    s.on('sliceduel_result', (data: {
      winnerWallet: string; yourScore: number; opponentScore: number; payoutLamports: number; claimId?: string | null; isTestCash?: boolean;
    }) => endGame(data));
    s.on('sliceduel_lobby_expired', () => {
      clearLobbyCountdown();
      setMyLobby(null);
      setBetError('Lobby expired — no one joined in 5 minutes. SOL refunded.');
    });

    s.emit('get_state');
    if (wallet) {
      s.emit('get_unclaimed_wins', { wallet });
      s.emit('sliceduel_get_lobbies');
      s.emit('get_mod_fruitroll_flags', { wallet });
    }

    setSocket(s);
    socketRef.current = s;
    return () => { s.disconnect(); };
  }, [wallet]);

  useEffect(() => {
    if (wallet) {
      const stored = localStorage.getItem(`username_${wallet}`);
      if (stored) setDisplayName(stored);
    }
  }, [wallet]);

  // ── Lobby countdown ──────────────────────────────────────────────────────
  const clearLobbyCountdown = useCallback(() => {
    if (lobbyCountdownRef.current) { clearInterval(lobbyCountdownRef.current); lobbyCountdownRef.current = null; }
  }, []);

  const startLobbyCountdown = useCallback(() => {
    setLobbyCountdown(300);
    clearLobbyCountdown();
    let secs = 300;
    lobbyCountdownRef.current = setInterval(() => {
      secs--;
      setLobbyCountdown(secs);
      if (secs <= 0) clearLobbyCountdown();
    }, 1000);
  }, [clearLobbyCountdown]);

  // ── Create lobby ─────────────────────────────────────────────────────────
  const handleCreateLobby = async () => {
    if (!wallet || !publicKey || !socket) return;
    setBetError('');
    const sol = parseFloat(wagerInput);
    if (isNaN(sol) || sol < 0.001) { setBetError('Minimum wager is 0.001 SOL'); return; }
    setBetLoading(true);

    if (!HOUSE_WALLET) { setBetError('House wallet not configured.'); setBetLoading(false); return; }

    // Mods with test cash active skip the real SOL transfer — server verifies mod status independently
    if (sliceDuelTestCash) {
      const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
      betTxSigRef.current = 'TEST_CASH';
      wagerLamportsRef.current = lamports;
      socket.emit('sliceduel_create_lobby', { wallet, displayName: displayName || wallet.slice(0, 8), wagerLamports: lamports, txSignature: 'TEST_CASH' });
      setBetLoading(false);
      return;
    }
    try {
      const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
      const balance = await connection.getBalance(publicKey);
      if (lamports + 5000 > balance) { setBetError('Insufficient balance.'); setBetLoading(false); return; }
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(HOUSE_WALLET), lamports }));
      tx.recentBlockhash = blockhash; tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection, { skipPreflight: false, preflightCommitment: 'confirmed' });
      setBetError('⏳ Confirming...');
      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const status = await connection.getSignatureStatus(sig, { searchTransactionHistory: false });
        const conf = status?.value?.confirmationStatus;
        if (status?.value?.err) { setBetError('Transaction failed on-chain.'); setBetLoading(false); return; }
        if (conf === 'confirmed' || conf === 'finalized') { confirmed = true; break; }
        const slot = await connection.getSlot();
        if (slot > lastValidBlockHeight) { setBetError('Transaction expired.'); setBetLoading(false); return; }
      }
      if (!confirmed) { setBetError('Timed out — try again.'); setBetLoading(false); return; }
      setBetError('');
      betTxSigRef.current = sig;
      wagerLamportsRef.current = lamports;
      socket.emit('sliceduel_create_lobby', { wallet, displayName: displayName || wallet.slice(0, 8), wagerLamports: lamports, txSignature: sig });
    } catch (e: any) { setBetError(e.message?.includes('rejected') ? 'Cancelled.' : e.message || 'Failed.'); }
    setBetLoading(false);
  };

  // ── Join lobby ───────────────────────────────────────────────────────────
  const handleJoinLobby = async (lobby: Lobby) => {
    if (!wallet || !publicKey || !socket) return;
    setJoinLoading(lobby.id); setBetError('');

    // Mods joining their own test cash lobby skip payment — server verifies mod status independently
    if (lobby.isTestCash && sliceDuelTestCash) {
      betTxSigRef.current = 'TEST_CASH';
      wagerLamportsRef.current = lobby.wagerLamports;
      socket.emit('sliceduel_join_lobby', { lobbyId: lobby.id, wallet, displayName: displayName || wallet.slice(0, 8), txSignature: 'TEST_CASH' });
      setJoinLoading(null);
      return;
    }

    try {
      const lamports = lobby.wagerLamports;
      const balance = await connection.getBalance(publicKey);
      if (lamports + 5000 > balance) { setBetError('Insufficient balance.'); setJoinLoading(null); return; }
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(HOUSE_WALLET), lamports }));
      tx.recentBlockhash = blockhash; tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection, { skipPreflight: false, preflightCommitment: 'confirmed' });
      setBetError('⏳ Confirming...');
      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const status = await connection.getSignatureStatus(sig, { searchTransactionHistory: false });
        const conf = status?.value?.confirmationStatus;
        if (status?.value?.err) { setBetError('Transaction failed.'); setJoinLoading(null); return; }
        if (conf === 'confirmed' || conf === 'finalized') { confirmed = true; break; }
      }
      if (!confirmed) { setBetError('Timed out.'); setJoinLoading(null); return; }
      setBetError('');
      betTxSigRef.current = sig;
      wagerLamportsRef.current = lamports;
      socket.emit('sliceduel_join_lobby', { lobbyId: lobby.id, wallet, displayName: displayName || wallet.slice(0, 8), txSignature: sig });
    } catch (e: any) { setBetError(e.message?.includes('rejected') ? 'Cancelled.' : e.message || 'Failed.'); }
    setJoinLoading(null);
  };

  // ── Countdown ────────────────────────────────────────────────────────────
  const startCountdown = useCallback(() => {
    setPhase('countdown');
    setCountdown(3);
    let c = 3;
    const iv = setInterval(() => {
      c--;
      setCountdown(c);
      if (c <= 0) { clearInterval(iv); startGame(); }
    }, 1000);
  }, []);

  // ── Spawn helper ─────────────────────────────────────────────────────────
  const spawnFruit = useCallback((canvas: HTMLCanvasElement) => {
    const rng = seedRngRef.current;
    if (!rng) return;
    const w = canvas.width;
    const h = canvas.height;
    // 70% single, 25% double, 5% triple — Fruit Ninja style
    const count = rng() < 0.05 ? 3 : rng() < 0.3 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      // Determine fruit type: 10% multiplier, 6% bomb, rest normal fruit
      let fruitIdx: number;
      const roll = rng();
      if (roll < 0.10) fruitIdx = -3;  // multiplier
      else if (roll < 0.16) fruitIdx = -1;  // bomb
      else fruitIdx = Math.floor(rng() * FRUITS.length);
      const radius = (fruitIdx < 0) ? 28 : 28 + Math.floor(rng() * 14);
      // Launch from lower third of screen width, avoid edges
      const x = radius * 3 + rng() * (w - radius * 6);
      // Cap vy so fruit never goes more than ~75% up the canvas
      const maxVy = -Math.sqrt(2 * GRAVITY * h * 0.75);
      const vy = maxVy * (0.88 + rng() * 0.18);
      const vx = (rng() - 0.5) * 9;
      fruitsRef.current.push({
        id: nextIdRef.current++,
        x, y: h + radius,
        vx, vy,
        rotation: rng() * Math.PI * 2,
        rotSpeed: (rng() - 0.5) * 0.1,
        radius,
        fruitIdx,
        sliced: false,
        sliceAngle: 0,
        halfOffset: 0,
        halfOffsetSpeed: 0,
        opacity: 1,
      });
    }
  }, []);

  // ── Juice particles on slice ─────────────────────────────────────────────
  const spawnParticles = useCallback((x: number, y: number, color: string, sliceAngle: number) => {
    // Main juice splat blobs — big and visible like Fruit Ninja
    const count = 14 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      const angle = sliceAngle + Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      const speed = 3 + Math.random() * 8;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1,
        decay: 0.018 + Math.random() * 0.022,
        radius: 5 + Math.random() * 9,
        color,
      });
    }
    // Small droplets spraying wide
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 1,
        decay: 0.03 + Math.random() * 0.04,
        radius: 2 + Math.random() * 3,
        color,
      });
    }
  }, []);

  // ── Canvas render loop ───────────────────────────────────────────────────
  const renderFrame = useCallback((canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, now: number) => {
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background gradient (cached, only rebuilt on resize)
    if (!bgGradientRef.current || bgGradientRef.current.w !== w || bgGradientRef.current.h !== h) {
      // Wooden board — warm brown tones like Fruit Ninja
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0,   '#6b3a1f');
      bg.addColorStop(0.4, '#7c4522');
      bg.addColorStop(1,   '#4a2510');
      bgGradientRef.current = { grad: bg, w, h };
    }
    ctx.fillStyle = bgGradientRef.current.grad;
    ctx.fillRect(0, 0, w, h);

    // Wood grain lines
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    const grainCount = Math.floor(w / 18);
    for (let gi = 0; gi < grainCount; gi++) {
      const gx = gi * 18 + 4;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx + 6, h);
      ctx.stroke();
    }
    ctx.restore();

    // ── Draw juice stains (organic splat, smooth ease-out fade) ─────────
    const STAIN_LIFE = 4000;
    stainsRef.current = stainsRef.current.filter(s => now - s.spawnedAt < STAIN_LIFE);
    for (const s of stainsRef.current) {
      const age = (now - s.spawnedAt) / STAIN_LIFE;
      // Ease-out cube: fast initial fade, smooth tail — no flicker
      const fade = 1 - age * age * age;
      if (fade <= 0) continue;
      ctx.save();
      ctx.globalAlpha = s.alpha * fade;
      ctx.fillStyle = s.color;

      // Central organic blob using bezier curves through random-radius points
      const pts = s.blobs.length;
      ctx.beginPath();
      for (let i = 0; i < pts; i++) {
        const b0 = s.blobs[i];
        const b1 = s.blobs[(i + 1) % pts];
        const mx = s.x + (b0.dx + b1.dx) / 2;
        const my = s.y + (b0.dy + b1.dy) / 2;
        if (i === 0) ctx.moveTo(mx, my);
        ctx.quadraticCurveTo(s.x + b0.dx, s.y + b0.dy, mx, my);
      }
      ctx.closePath();
      ctx.fill();

      // Satellite droplets — small teardrop ellipses
      for (const b of s.drops) {
        ctx.save();
        ctx.translate(s.x + b.dx, s.y + b.dy);
        ctx.rotate(b.angle);
        ctx.scale(1, b.stretch);
        ctx.beginPath();
        ctx.arc(0, 0, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    }

    // ── Draw slice trail ─────────────────────────────────────────────────
    const trail = trailRef.current.filter(p => now - p.t < TRAIL_FADE_MS);
    trailRef.current = trail;
    if (trail.length > 1) {
      for (let i = 1; i < trail.length; i++) {
        const age = (now - trail[i].t) / TRAIL_FADE_MS;
        const alpha = Math.max(0, 1 - age);
        const thickness = alpha * 6 + 1;

        // Wide glowing core — bright white like Fruit Ninja
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.9})`;
        ctx.lineWidth = thickness;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Soft outer glow
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.strokeStyle = `rgba(200,240,255,${alpha * 0.3})`;
        ctx.lineWidth = thickness * 3;
        ctx.stroke();
      }
    }

    // ── Draw particles ───────────────────────────────────────────────────
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);
    for (const p of particlesRef.current) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.15;
      p.life -= p.decay;
      if (p.life <= 0) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0, p.radius * p.life), 0, Math.PI * 2);
      ctx.fillStyle = p.color.replace(')', `,${p.life})`).replace('rgb', 'rgba').replace('rgba(', 'rgba(');
      // Safer color injection:
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ── Draw fruits ──────────────────────────────────────────────────────
    fruitsRef.current = fruitsRef.current.filter(f => f.opacity > 0 && f.y < h + 120);
    for (const f of fruitsRef.current) {
      if (!f.sliced) {
        // Physics
        f.x += f.vx;
        f.y += f.vy;
        f.vy += GRAVITY;
        f.rotation += f.rotSpeed;
      } else {
        // Halves drift apart and fall faster — Fruit Ninja style
        f.halfOffset += f.halfOffsetSpeed;
        f.halfOffsetSpeed += 0.5;
        f.vy += GRAVITY * 2;
        f.y += f.vy * 0.6;
        f.x += f.vx * 0.5;
        f.opacity -= 0.022;
        f.rotation += f.rotSpeed * 3;
      }

      const emoji = f.fruitIdx === -1 ? '💣' : f.fruitIdx === -2 ? '❄️' : f.fruitIdx === -3 ? '⭐' : FRUITS[f.fruitIdx].emoji;
      const diameter = f.radius * 2;
      const ec = getEmojiCanvas(emoji, f.radius);

      if (!f.sliced) {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rotation);
        ctx.globalAlpha = f.opacity;
        ctx.drawImage(ec, -f.radius, -f.radius, diameter, diameter);
        ctx.restore();
      } else {
        // Draw two halves separating perpendicular to slice angle
        const perpX = Math.cos(f.sliceAngle + Math.PI / 2);
        const perpY = Math.sin(f.sliceAngle + Math.PI / 2);
        const offset = f.halfOffset;

        for (const sign of [-1, 1]) {
          ctx.save();
          ctx.translate(f.x + perpX * offset * sign, f.y + perpY * offset * sign);
          ctx.rotate(f.rotation + sign * 0.3);
          ctx.globalAlpha = f.opacity;
          // Clip to half
          ctx.beginPath();
          const clipAngle = f.sliceAngle + (sign === 1 ? 0 : Math.PI);
          ctx.arc(0, 0, f.radius * 1.2, clipAngle, clipAngle + Math.PI);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(ec, -f.radius, -f.radius, diameter, diameter);
          ctx.restore();
        }
      }
    }

    // ── Score popups ─────────────────────────────────────────────────────
    scorePopupsRef.current = scorePopupsRef.current.filter(p => p.life > 0);
    for (const p of scorePopupsRef.current) {
      p.y += p.vy;
      p.vy *= 0.95;
      p.life -= 0.018;
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 3);
      ctx.font = `bold ${18 + (1 - p.life) * 4}px 'Space Grotesk', sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }

    // ── Active power-up circle countdown ────────────────────────────────
    const multRemaining = multiplierUntilRef.current - now;
    const showCircle = multRemaining > 0;
    if (showCircle) {
      const remaining = multRemaining;
      const total = 5000;
      const frac = Math.max(0, remaining / total);
      const cx = w - 54, cy = 54, cr = 28;

      ctx.save();
      // Background circle
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
      // Progress arc
      ctx.beginPath();
      ctx.arc(cx, cy, cr, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.stroke();
      // Icon
      ctx.font = `${cr * 0.9}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐', cx, cy);
      // Seconds remaining
      ctx.font = `bold 10px 'Space Grotesk', sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`${(remaining / 1000).toFixed(1)}s`, cx, cy + cr + 12);
      ctx.restore();
    }
  }, [getEmojiCanvas]);

  // ── Start game ───────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    scoreRef.current = 0;
    comboRef.current = 0;
    fruitsRef.current = [];
    particlesRef.current = [];
    trailRef.current = [];
    scorePopupsRef.current = [];
    stainsRef.current = [];
    setScore(0);
    setOpponentScore(0);
    setCombo(0);
    setTimeLeft(GAME_DURATION);
    timeLeftRef.current = GAME_DURATION;
    setPhase('playing');

    // Wall-clock game start — independent per client, no sync
    gameStartTimeRef.current = performance.now();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    // Spawn interval — uses seeded RNG for fruit type/position, wall clock for timing
    const spawnInterval = 1100; // ms between spawn events
    let lastSpawn = performance.now();

    // HUD timer — separate setInterval, purely cosmetic
    const hudTimer = setInterval(() => {
      const elapsed = (performance.now() - gameStartTimeRef.current) / 1000;
      const tl = Math.max(0, GAME_DURATION - elapsed);
      timeLeftRef.current = tl;
      setTimeLeft(Math.ceil(tl));

      if (tl <= 0) {
        clearInterval(hudTimer);
        // Stop spawn
        if (spawnTimerRef.current) { clearInterval(spawnTimerRef.current); spawnTimerRef.current = null; }
        stopGame();
      }
    }, 200); // poll at 5Hz for smooth timer, not synced to frame

    // RAF loop
    let animRunning = true;
    const loop = (now: number) => {
      if (!animRunning) return;

      // Spawn fruits based on wall clock, not frame count
      if (now - lastSpawn > spawnInterval) {
        lastSpawn = now;
        if (timeLeftRef.current > 0) spawnFruit(canvas);
      }

      renderFrame(canvas, ctx, now);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    // Cleanup RAF when component unmounts or game ends
    return () => { animRunning = false; clearInterval(hudTimer); };
  }, [spawnFruit, renderFrame]);

  const stopGame = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (spawnTimerRef.current) { clearInterval(spawnTimerRef.current); spawnTimerRef.current = null; }
    const s = socketRef.current; const w = walletRef.current;
    if (s && w) {
      s.emit('sliceduel_game_end', { matchId: matchIdRef.current, wallet: w, score: scoreRef.current });
      // Also emit final score so server has it for disconnect-payout resolution
      s.emit('sliceduel_score_update', { matchId: matchIdRef.current, wallet: w, score: scoreRef.current, isFinal: true });
    }
  }, []);

  const endGame = useCallback((data: { winnerWallet: string; yourScore: number; opponentScore: number; payoutLamports: number; claimId?: string | null }) => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (spawnTimerRef.current) { clearInterval(spawnTimerRef.current); spawnTimerRef.current = null; }
    const won = data.winnerWallet === walletRef.current;
    setPlayerWon(won);
    setFinalScore(data.yourScore);
    setFinalOpponentScore(data.opponentScore);
    setPayoutAmount(data.payoutLamports);
    claimInFlight.current = false;
    if (won && data.payoutLamports > 0 && data.claimId) {
      setClaimId(data.claimId);
      setClaimState('ready');
    } else if (won && data.payoutLamports > 0 && !data.claimId) {
      setClaimState('error');
      setClaimError('Claim not ready — check Settings → Unclaimed Winnings');
    } else {
      setClaimState(null);
    }
    setPhase('result');
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (spawnTimerRef.current) clearInterval(spawnTimerRef.current);
    clearLobbyCountdown();
  }, [clearLobbyCountdown]);

  // ── Canvas resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Pointer handling ─────────────────────────────────────────────────────
  const getCanvasPos = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleSlice = useCallback((ax: number, ay: number, bx: number, by: number, now: number) => {
    if (phaseRef.current !== 'playing') return;
    const sliceAngle = Math.atan2(by - ay, bx - ax);

    for (const f of fruitsRef.current) {
      if (f.sliced) continue;
      if (!segmentCircle(ax, ay, bx, by, f.x, f.y, f.radius * 0.85)) continue;

      f.sliced = true;
      f.sliceAngle = sliceAngle;
      f.halfOffsetSpeed = 1.5;

      if (f.fruitIdx === -1) {
        // Bomb
        scoreRef.current = Math.max(0, scoreRef.current - 5);
        setScore(scoreRef.current);
        comboRef.current = 0;
        setCombo(0);
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 1 + Math.random() * 6;
          particlesRef.current.push({ x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: 1, decay: 0.02 + Math.random() * 0.02, radius: 3 + Math.random() * 5, color: '#ef4444' });
        }
        scorePopupsRef.current.push({ id: popupIdRef.current++, x: f.x, y: f.y - 20, text: '−5 💣', color: '#f87171', vy: -2.5, life: 1 });

      } else if (f.fruitIdx === -3) {
        // Score multiplier — 2× points for 5s
        const expiresAt = performance.now() + 5000;
        multiplierUntilRef.current = expiresAt;
        setActivePowerup({ type: 'multiplier', expiresAt });
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * Math.PI * 2;
          particlesRef.current.push({ x: f.x, y: f.y, vx: Math.cos(a) * (2 + Math.random() * 5), vy: Math.sin(a) * (2 + Math.random() * 5) - 2, life: 1, decay: 0.018 + Math.random() * 0.02, radius: 3 + Math.random() * 6, color: 'rgba(251,191,36,0.9)' });
        }
        scorePopupsRef.current.push({ id: popupIdRef.current++, x: f.x, y: f.y - 20, text: '⭐ 2× POINTS!', color: '#fbbf24', vy: -2.5, life: 1 });

      } else {
        const fruit = FRUITS[f.fruitIdx];
        const hasMult = performance.now() < multiplierUntilRef.current;
        const isCombo = comboRef.current >= 3;
        const pts = fruit.points * (isCombo ? 2 : 1) * (hasMult ? 2 : 1);
        scoreRef.current += pts;
        setScore(scoreRef.current);
        // Emit score on every slice for live HUD updates
        const s2 = socketRef.current; const w3 = walletRef.current;
        if (s2 && w3) s2.emit('sliceduel_score_update', { matchId: matchIdRef.current, wallet: w3, score: scoreRef.current });
        comboRef.current++;
        setCombo(comboRef.current);
        if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
        comboTimerRef.current = setTimeout(() => { comboRef.current = 0; setCombo(0); }, 1800);

        spawnParticles(f.x, f.y, fruit.juiceColor, sliceAngle);

        // Juice stain — organic bezier splat + teardrop droplets
        const blobCount = 8 + Math.floor(Math.random() * 5);
        const baseR = 30 + Math.random() * 22;
        const blobs = Array.from({ length: blobCount }, (_, i) => {
          const angle = (i / blobCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
          const r = baseR * (0.55 + Math.random() * 0.65);
          return { dx: Math.cos(angle) * r, dy: Math.sin(angle) * r, r };
        });
        const drops = Array.from({ length: 5 + Math.floor(Math.random() * 6) }, () => {
          const angle = Math.random() * Math.PI * 2;
          const dist = baseR * (1.1 + Math.random() * 1.2);
          return {
            dx: Math.cos(angle) * dist,
            dy: Math.sin(angle) * dist,
            r: 4 + Math.random() * 10,
            angle: angle + Math.PI / 2,
            stretch: 1.2 + Math.random() * 1.0,
          };
        });
        stainsRef.current.push({ x: f.x, y: f.y, r: baseR, color: fruit.juiceColor, alpha: 0.12 + Math.random() * 0.06, blobs, drops, spawnedAt: performance.now() });
        if (stainsRef.current.length > 30) stainsRef.current.shift();
        const label = hasMult && isCombo ? `+${pts} 🔥⭐` : hasMult ? `+${pts} ⭐` : isCombo ? `+${pts} 🔥×2` : `+${pts}`;
        scorePopupsRef.current.push({ id: popupIdRef.current++, x: f.x, y: f.y - 20, text: label, color: hasMult ? '#fbbf24' : isCombo ? '#fbbf24' : fruit.color, vy: -2.5, life: 1 });
      }
    }
  }, [spawnParticles]);

  const onPointerDown = useCallback((x: number, y: number) => {
    isSlicingRef.current = true;
    lastPointerRef.current = { x, y };
    trailRef.current.push({ x, y, t: performance.now() });
  }, []);

  const onPointerMove = useCallback((x: number, y: number) => {
    const now = performance.now();
    trailRef.current.push({ x, y, t: now });
    if (trailRef.current.length > TRAIL_MAX) trailRef.current.shift();
    if (!lastPointerRef.current) { lastPointerRef.current = { x, y }; return; }
    handleSlice(lastPointerRef.current.x, lastPointerRef.current.y, x, y, now);
    lastPointerRef.current = { x, y };
  }, [handleSlice]);

  const onPointerUp = useCallback(() => {
    isSlicingRef.current = false;
    lastPointerRef.current = null;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== 'playing') return;
    const { x, y } = getCanvasPos(e);
    onPointerDown(x, y);
  }, [onPointerDown]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== 'playing') return;
    const { x, y } = getCanvasPos(e);
    onPointerMove(x, y);
  }, [onPointerMove]);

  const handleMouseLeave = useCallback(() => {
    // Clear last pointer so trail doesn't jump on re-entry
    lastPointerRef.current = null;
    trailRef.current = [];
  }, []);

  const handleMouseUp = useCallback(() => onPointerUp(), [onPointerUp]);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== 'playing') return;
    e.preventDefault();
    const t = e.touches[0];
    const { x, y } = getCanvasPos(t);
    onPointerDown(x, y);
  }, [onPointerDown]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== 'playing') return;
    e.preventDefault();
    const t = e.touches[0];
    const { x, y } = getCanvasPos(t);
    onPointerMove(x, y);
  }, [onPointerMove]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    onPointerUp();
  }, [onPointerUp]);

  // ── Claim / Reset ────────────────────────────────────────────────────────
  const handleClaim = () => {
    if (claimInFlight.current || claimState === 'claiming' || !claimId || !socket || !wallet) return;
    claimInFlight.current = true;
    setClaimState('claiming');
    setClaimError('');
    socket.emit('claim_payout', { wallet, roundId: claimId });
    socket.once('claim_result', (res: { success: boolean; claimTx?: string; error?: string; alreadyClaimed?: boolean }) => {
      claimInFlight.current = false;
      if (res.success || res.alreadyClaimed) {
        setClaimState('success');
        setClaimTx(res.claimTx || null);
        socket.emit('get_unclaimed_wins', { wallet });
      } else {
        setClaimState('error');
        setClaimError(res.error || 'Claim failed — please try again');
      }
    });
  };

  const resetToLobby = () => {
    setPhase('lobby'); setMyLobby(null); setMatchedLobby(null);
    setScore(0); setOpponentScore(0); setCombo(0);
    setClaimId(null); setClaimState(null); setClaimTx(null); setClaimError('');
    claimInFlight.current = false;
    matchIdRef.current = null; betTxSigRef.current = null;
    fruitsRef.current = []; particlesRef.current = []; trailRef.current = [];
    if (socket && wallet) socket.emit('sliceduel_get_lobbies');
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const fmtTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(Math.ceil(s) % 60).toString().padStart(2, '0')}`;
  const fmtSol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(3);
  const activeLobbyWager = matchedLobby?.wagerLamports || 0;
  const potSol = activeLobbyWager > 0 ? fmtSol(activeLobbyWager * 2) : '0.000';
  const payoutSol = activeLobbyWager > 0 ? fmtSol(Math.floor(activeLobbyWager * 2 * (1 - HOUSE_FEE))) : '0.000';

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Slice Duel — FruitBowl.fun</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

        {/* ── HEADER ── */}
        <header style={{ display: 'flex', alignItems: 'center', height: '58px', flexShrink: 0, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', padding: '0 20px', gap: '16px' }}>
          <div onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer' }}>
            <span style={{ fontSize: '26px', lineHeight: 1 }}>🍓</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', color: '#e53e3e', letterSpacing: '-0.01em' }}>
              FruitBowl<span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>.fun</span>
            </span>
          </div>
          <nav style={{ display: 'flex', alignItems: 'center', height: '100%', marginLeft: '8px' }}>
            {[
              { label: '🍊 Orangepot', path: '/' },
              { label: '🍉 FruitRoll', path: '/fruitroll' },
              { label: '🔪 Slice Duel', path: '/sliceduel', active: true },
              { label: '🔗 Referrals', path: '/referral' },
            ].map(item => (
              <div key={item.path} onClick={() => router.push(item.path)} style={{ height: '100%', display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: item.active ? '2px solid #e53e3e' : '2px solid transparent', color: item.active ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', letterSpacing: '0.01em', transition: 'color 0.15s, border-color 0.15s' }}
                onMouseEnter={e => { if (!item.active) (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { if (!item.active) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
              >{item.label}</div>
            ))}
          </nav>
          <div style={{ flex: 1 }} />
          {wallet && (
            <button onClick={() => setShowSettings(true)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-muted)', cursor: 'pointer', width: '34px', height: '34px', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>⚙️</button>
          )}
          <WalletMultiButton />
        </header>

        {/* Unclaimed banner */}
        {wallet && unclaimedTotal > 0 && (
          <div onClick={() => setShowSettings(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'linear-gradient(90deg,rgba(16,185,129,0.15),rgba(16,185,129,0.08),rgba(16,185,129,0.15))', borderBottom: '1px solid rgba(16,185,129,0.35)', padding: '9px 20px', cursor: 'pointer', flexShrink: 0 }}>
            <span style={{ fontSize: '16px' }}>💰</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: '#10b981' }}>You have <strong>{fmtSol(unclaimedTotal)} SOL</strong> in unclaimed winnings</span>
            <span style={{ fontSize: '11px', color: 'rgba(16,185,129,0.7)', fontFamily: 'var(--font-display)', fontWeight: 600, textDecoration: 'underline' }}>Claim in Settings →</span>
          </div>
        )}

        {/* ── BODY ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── LEFT PANEL ── */}
          <div style={{ width: '280px', flexShrink: 0, borderRight: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '20px 16px', gap: '14px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '4px' }}>🔪</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '22px', color: 'var(--text-primary)' }}>Slice Duel</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>1v1 · Same fruits · Top score wins</div>
            </div>

            {/* Wager input */}
            {phase === 'lobby' && !myLobby && (
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '14px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  SET WAGER
                </div>
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0 14px', height: '46px', gap: '10px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '18px' }}>🔪</span>
                  <input type="number" value={wagerInput} onChange={e => setWagerInput(e.target.value)}
                    min="0.001" step="0.001" placeholder="0.1"
                    style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '17px', outline: 'none', padding: 0 }} />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'Space Mono, monospace' }}>SOL</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                  {QUICK_AMOUNTS.map(v => (
                    <button key={v} onClick={() => setWagerInput(v)} style={{ flex: 1, padding: '5px 0', borderRadius: '6px', border: wagerInput === v ? '1px solid rgba(229,62,62,0.5)' : '1px solid var(--border-color)', background: wagerInput === v ? 'rgba(229,62,62,0.12)' : 'rgba(255,255,255,0.03)', color: wagerInput === v ? '#fc8181' : 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>{v}</button>
                  ))}
                </div>
                {wagerInput && parseFloat(wagerInput) >= 0.001 && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '10px', lineHeight: 1.6 }}>
                    Pot: <span style={{ color: 'var(--orange-soft)', fontWeight: 700 }}>◎ {(parseFloat(wagerInput) * 2).toFixed(3)}</span>
                    {' · '}Win: <span style={{ color: '#48bb78', fontWeight: 700 }}>◎ {(parseFloat(wagerInput) * 2 * (1 - HOUSE_FEE)).toFixed(3)}</span>
                  </div>
                )}
                {isGameLocked && (
                  <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', fontSize: '11px', color: '#f87171', fontFamily: 'var(--font-display)', fontWeight: 700, textAlign: 'center', marginBottom: '8px' }}>
                    🔒 GAME LOCKED BY MODERATOR
                  </div>
                )}
                {betError && (
                  <div style={{ marginBottom: '8px', fontSize: '11px', color: betError.startsWith('⏳') ? '#fbbf24' : '#f87171', fontFamily: 'var(--font-display)', fontWeight: 600, textAlign: 'center' }}>{betError}</div>
                )}
                {!wallet ? (
                  <WalletMultiButton style={{ width: '100%', height: '48px', borderRadius: '10px', fontSize: '13px', fontFamily: 'var(--font-display)', fontWeight: 700 }} />
                ) : (
                  <button onClick={handleCreateLobby} disabled={betLoading || isGameLocked || !wagerInput}
                    style={{ width: '100%', height: '48px', borderRadius: '10px', border: 'none', background: (betLoading || !wagerInput) ? 'rgba(255,255,255,0.07)' : 'linear-gradient(135deg,#c53030,#e53e3e)', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', cursor: (betLoading || !wagerInput || isGameLocked) ? 'not-allowed' : 'pointer', opacity: (!wagerInput || isGameLocked) ? 0.5 : 1, letterSpacing: '0.05em', transition: 'all 0.2s', boxShadow: wagerInput ? '0 4px 20px rgba(229,62,62,0.4)' : 'none' }}>
                    {betLoading ? '⏳ Confirming...' : '🔪 Create Lobby'}
                  </button>
                )}
              </div>
            )}

            {/* Waiting for opponent */}
            {phase === 'lobby' && myLobby && (
              <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(229,62,62,0.3)', borderRadius: '14px', padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>⏳</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>Lobby Open</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '12px' }}>Waiting for an opponent to match your wager…</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Wager</span>
                  <span style={{ color: 'var(--orange-soft)', fontWeight: 700 }}>◎ {fmtSol(myLobby.wagerLamports)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '12px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Expires in</span>
                  <span style={{ color: lobbyCountdown < 60 ? '#f87171' : 'var(--text-secondary)', fontWeight: 700 }}>{fmtTime(lobbyCountdown)}</span>
                </div>
                <button onClick={() => { socket?.emit('sliceduel_cancel_lobby', { lobbyId: myLobby.id, wallet }); setMyLobby(null); clearLobbyCountdown(); }}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
                  Cancel & Refund
                </button>
              </div>
            )}

            {/* In-game stats */}
            {(phase === 'playing' || phase === 'countdown') && matchedLobby && (
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>MATCH</span>
                  <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '11px', color: timeLeft <= 10 ? '#f87171' : 'var(--orange-soft)', fontWeight: 700 }}>{fmtTime(timeLeft)}</span>
                </div>
                <div style={{ background: 'rgba(229,62,62,0.1)', border: '1px solid rgba(229,62,62,0.25)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '4px' }}>YOUR SCORE</div>
                  <div style={{ fontSize: '32px', fontFamily: 'var(--font-display)', fontWeight: 800, color: '#fc8181' }}>{score}</div>
                </div>
                {combo >= 2 && (
                  <div style={{ textAlign: 'center', padding: '6px', background: 'rgba(255,140,0,0.12)', border: '1px solid rgba(255,140,0,0.3)', borderRadius: '8px' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '13px', color: 'var(--orange-bright)' }}>
                      🔥 {combo}× COMBO{combo >= 3 ? ' · 2× POINTS!' : ''}
                    </span>
                  </div>
                )}
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Pot: <span style={{ color: 'var(--orange-soft)', fontWeight: 700 }}>◎ {potSol}</span>
                  {' · '}Win: <span style={{ color: '#48bb78', fontWeight: 700 }}>◎ {payoutSol}</span>
                </div>
              </div>
            )}

            {/* How it works */}
            {phase === 'lobby' && (
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '14px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: '10px' }}>HOW IT WORKS</div>
                {[
                  ['🔪', 'Wager SOL — opponent matches it'],
                  ['🌱', 'Same fruit seed — identical patterns'],
                  ['⚡', 'Swipe through fruit to slice — avoid bombs 💣'],
                  ['🔥', 'Chain slices for 2× combo bonus'],
                  ['🏆', 'Higher score wins 95% of the pot'],
                ].map(([icon, text]) => (
                  <div key={text as string} style={{ display: 'flex', gap: '8px', marginBottom: '7px', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '12px', flexShrink: 0 }}>{icon}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{text}</span>
                  </div>
                ))}
                <div style={{ marginTop: '8px', fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
                  FruitBowl.fun · 5% house edge
                </div>
              </div>
            )}
          </div>

          {/* ── CENTER: Game area ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

            {/* Countdown overlay */}
            {phase === 'countdown' && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '120px', color: '#e53e3e', filter: 'drop-shadow(0 0 30px rgba(229,62,62,0.8))', lineHeight: 1, textAlign: 'center' }}>
                    {countdown > 0 ? countdown : 'GO!'}
                  </div>
                  {matchedLobby && (
                    <div style={{ textAlign: 'center', marginTop: '16px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: 'var(--text-secondary)' }}>
                      vs {matchedLobby.creatorWallet === wallet ? matchedLobby.opponentName : matchedLobby.creatorName} · ◎ {potSol} pot
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Result overlay */}
            {phase === 'result' && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
                <div style={{ textAlign: 'center', background: 'linear-gradient(145deg,#0d0520,#13082a)', border: `2px solid ${playerWon ? '#48bb78' : '#ef4444'}`, borderRadius: '24px', padding: '48px 56px', boxShadow: `0 0 80px ${playerWon ? 'rgba(72,187,120,0.4)' : 'rgba(239,68,68,0.3)'}`, minWidth: '360px' }}>
                  <div style={{ fontSize: '64px', marginBottom: '8px' }}>{playerWon ? '🏆' : '😔'}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '32px', color: playerWon ? '#48bb78' : '#f87171', marginBottom: '8px' }}>
                    {playerWon ? '🎉 YOU WIN!' : 'Better Luck!'}
                  </div>
                  <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginBottom: '16px' }}>
                    <div style={{ background: 'rgba(229,62,62,0.1)', border: '1px solid rgba(229,62,62,0.25)', borderRadius: '10px', padding: '10px 20px' }}>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.08em' }}>YOUR SCORE</div>
                      <div style={{ fontSize: '28px', fontFamily: 'var(--font-display)', fontWeight: 800, color: '#fc8181' }}>{finalScore}</div>
                    </div>
                    <div style={{ background: 'rgba(72,187,120,0.1)', border: '1px solid rgba(72,187,120,0.2)', borderRadius: '10px', padding: '10px 20px' }}>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.08em' }}>OPPONENT</div>
                      <div style={{ fontSize: '28px', fontFamily: 'var(--font-display)', fontWeight: 800, color: '#48bb78' }}>{finalOpponentScore}</div>
                    </div>
                  </div>
                  {playerWon && payoutAmount > 0 && (
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '36px', color: '#48bb78', textShadow: '0 0 24px rgba(72,187,120,0.5)', marginBottom: '16px' }}>
                      +{fmtSol(payoutAmount)} ◎
                    </div>
                  )}
                  {playerWon && payoutAmount > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      {claimState === 'success' ? (
                        <div style={{ padding: '14px', background: 'rgba(72,187,120,0.12)', border: '1px solid rgba(72,187,120,0.4)', borderRadius: '12px', marginBottom: '10px' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', color: '#48bb78', marginBottom: '4px' }}>✅ Prize Sent!</div>
                          {claimTx && (
                            <a href={`https://explorer.solana.com/tx/${claimTx}`} target="_blank" rel="noreferrer"
                              style={{ fontSize: '11px', color: '#48bb78', textDecoration: 'underline', fontFamily: 'Space Mono, monospace' }}>
                              View on Explorer ↗
                            </a>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={handleClaim}
                          disabled={!claimId || claimState === 'claiming'}
                          style={{
                            display: 'block', width: '100%', padding: '16px',
                            borderRadius: '12px', border: 'none',
                            cursor: (!claimId || claimState === 'claiming') ? 'not-allowed' : 'pointer',
                            background: (!claimId || claimState === 'claiming')
                              ? 'rgba(255,255,255,0.08)'
                              : 'linear-gradient(135deg,#48bb78,#38a169)',
                            color: '#fff',
                            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '17px',
                            letterSpacing: '0.04em',
                            boxShadow: claimId && claimState === 'ready' ? '0 0 28px rgba(72,187,120,0.45)' : 'none',
                            transition: 'all 0.2s',
                            opacity: (!claimId || claimState === 'claiming') ? 0.65 : 1,
                            marginBottom: '8px',
                          }}
                        >
                          {claimState === 'claiming' ? '⏳ Sending...' :
                           claimState === 'error' ? '💰 Retry Claim' :
                           claimId ? `💰 Claim ${fmtSol(payoutAmount)} SOL` :
                           '⏳ Preparing claim...'}
                        </button>
                      )}
                      {claimState === 'error' && claimError && (
                        <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', fontSize: '11px', color: '#f87171', marginTop: '6px' }}>
                          {claimError}
                        </div>
                      )}
                      {!claimId && claimState !== 'error' && (
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
                          If claim doesn't appear, check Settings → Unclaimed Winnings
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={resetToLobby} style={{ padding: '14px 40px', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg,#c53030,#e53e3e)', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', cursor: 'pointer', letterSpacing: '0.05em' }}>🔄 Play Again</button>
                </div>
              </div>
            )}

            {/* Lobby browser */}
            {phase === 'lobby' && !myLobby && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
                <div style={{ maxWidth: '700px', margin: '0 auto' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>OPEN LOBBIES</span>
                    <span style={{ padding: '1px 8px', background: 'rgba(229,62,62,0.15)', border: '1px solid rgba(229,62,62,0.3)', borderRadius: '20px', color: '#fc8181', fontSize: '10px' }}>{openLobbies.length}</span>
                  </div>
                  {openLobbies.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px' }}>
                      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔪</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '6px' }}>No open lobbies</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Create one and wait for an opponent, or refresh.</div>
                    </div>
                  ) : openLobbies.map(lobby => (
                    <div key={lobby.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'linear-gradient(135deg,rgba(229,62,62,0.3),rgba(229,62,62,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>🔪</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '3px' }}>{lobby.creatorName}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Space Mono, monospace' }}>{lobby.creatorWallet.slice(0, 8)}…</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', color: 'var(--orange-bright)', marginBottom: '2px' }}>◎ {fmtSol(lobby.wagerLamports)}</div>
                        <div style={{ fontSize: '10px', color: '#48bb78' }}>Win ◎ {fmtSol(Math.floor(lobby.wagerLamports * 2 * (1 - HOUSE_FEE)))}</div>
                      </div>
                      {!wallet ? (
                        <WalletMultiButton style={{ height: '40px', borderRadius: '8px', fontSize: '12px', padding: '0 12px', flexShrink: 0 }} />
                      ) : (
                        <button onClick={() => handleJoinLobby(lobby)} disabled={!!joinLoading}
                          style={{ height: '40px', padding: '0 18px', borderRadius: '10px', border: 'none', background: joinLoading === lobby.id ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg,#c53030,#e53e3e)', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '13px', cursor: joinLoading ? 'not-allowed' : 'pointer', flexShrink: 0, transition: 'all 0.2s', boxShadow: joinLoading ? 'none' : '0 2px 12px rgba(229,62,62,0.4)' }}>
                          {joinLoading === lobby.id ? '⏳' : '⚔️ Match It'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Waiting for match */}
            {phase === 'lobby' && myLobby && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px', display: 'inline-block' }}>🔪</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '20px', color: 'var(--text-primary)', marginBottom: '8px' }}>Lobby Live</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Waiting for someone to match your ◎ {fmtSol(myLobby.wagerLamports)} wager…</div>
                </div>
              </div>
            )}

            {/* ── CANVAS GAME AREA ── */}
            <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', display: (phase === 'playing' || phase === 'countdown') ? 'block' : 'none' }}>

              {/* Time bar */}
              {phase === 'playing' && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'rgba(255,255,255,0.08)', zIndex: 5, pointerEvents: 'none' }}>
                  <div style={{ height: '100%', width: `${(timeLeft / GAME_DURATION) * 100}%`, background: timeLeft > 20 ? 'linear-gradient(90deg,#e53e3e,#ff8c00)' : '#f87171', transition: 'width 0.2s linear, background 0.3s' }} />
                </div>
              )}

              {/* Score HUD — canvas overlay via absolute divs */}
              {(phase === 'playing') && (
                <>
                  <div style={{ position: 'absolute', top: '12px', left: '12px', zIndex: 5, pointerEvents: 'none' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '32px', color: '#fc8181', lineHeight: 1, textShadow: '0 0 20px rgba(252,129,129,0.5)' }}>{score}</div>
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em', fontFamily: 'var(--font-display)', fontWeight: 700 }}>YOUR SCORE</div>
                  </div>
                  <div style={{ position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 5, textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontFamily: 'Space Mono, monospace', fontWeight: 700, fontSize: '20px', color: timeLeft <= 10 ? '#f87171' : 'rgba(255,255,255,0.7)', textShadow: timeLeft <= 10 ? '0 0 14px rgba(248,113,113,0.8)' : 'none' }}>{fmtTime(timeLeft)}</div>
                  </div>
                  <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 5, textAlign: 'right', pointerEvents: 'none' }}>
                  </div>
                  {combo >= 3 && (
                    <div style={{ position: 'absolute', top: '70px', left: '50%', transform: 'translateX(-50%)', zIndex: 6, textAlign: 'center', pointerEvents: 'none' }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '20px', color: '#fbbf24', textShadow: '0 0 16px rgba(251,191,36,0.9)', animation: 'combo-pulse 0.4s ease-in-out infinite alternate' }}>
                        🔥 {combo}× COMBO · 2× POINTS!
                      </div>
                    </div>
                  )}
                </>
              )}

              <canvas
                ref={canvasRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: phase === 'playing' ? 'none' : 'default', touchAction: 'none' }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              />
            </div>
          </div>

          {/* ── RIGHT PANEL: Fruit scoring guide ── */}
          <div style={{ width: '200px', flexShrink: 0, borderLeft: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>FRUIT POINTS</div>
            </div>
            <div style={{ padding: '10px', flex: 1 }}>
              {FRUITS.map(f => (
                <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', marginBottom: '6px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <span style={{ fontSize: '20px' }}>{f.emoji}</span>
                  <span style={{ flex: 1, fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>{f.name}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '13px', color: f.color }}>+{f.points}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', marginBottom: '6px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px' }}>
                <span style={{ fontSize: '20px' }}>💣</span>
                <span style={{ flex: 1, fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>Bomb</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '13px', color: '#f87171' }}>−5</span>
              </div>
              <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(255,140,0,0.06)', border: '1px solid rgba(255,140,0,0.2)', borderRadius: '8px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '6px' }}>COMBO BONUS</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Slice 3+ fruits without missing or hitting a bomb for <span style={{ color: 'var(--orange-soft)', fontWeight: 700 }}>2× points</span> per fruit.
                </div>
              </div>
            </div>
            <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-color)', fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
              FruitBowl.fun · 5% house edge · Solana
            </div>
          </div>
        </div>
      </div>

      {showSettings && wallet && (
        <SettingsModal wallet={wallet} currentDisplayName={displayName} socket={socket} onClose={() => setShowSettings(false)} onUsernameChanged={(name) => { setDisplayName(name); setShowSettings(false); }} />
      )}

      <style>{`
        @keyframes combo-pulse {
          from { transform: translateX(-50%) scale(1); }
          to   { transform: translateX(-50%) scale(1.08); }
        }
      `}</style>
    </>
  );
}

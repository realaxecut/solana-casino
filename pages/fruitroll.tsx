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
const HOUSE_EDGE = 0.05;

// ── Fruit definitions ──────────────────────────────────────────────────────────
const FRUITS = [
  { id: 'strawberry', emoji: '🍓', name: 'Strawberry', color: '#e53e3e', track: '#2a0a0a' },
  { id: 'orange',     emoji: '🍊', name: 'Orange',     color: '#ff8c00', track: '#1e1000' },
  { id: 'banana',     emoji: '🍌', name: 'Banana',     color: '#f6e05e', track: '#1a1800' },
  { id: 'grape',      emoji: '🍇', name: 'Grape',      color: '#9f7aea', track: '#150a28' },
  { id: 'watermelon', emoji: '🍉', name: 'Watermelon', color: '#48bb78', track: '#0a1a10' },
  { id: 'cherry',     emoji: '🍒', name: 'Cherry',     color: '#fc8181', track: '#1e0808' },
];

// Payout: winner gets back N × bet × (1 - houseEdge)
// e.g. 2 fruits → 2 × 0.95 = 1.90× (net profit +0.90×)
//      6 fruits → 6 × 0.95 = 5.70× (net profit +4.70×)
function getPayout(fruitCount: number, betLamports: number): number {
  return Math.floor(betLamports * fruitCount * (1 - HOUSE_EDGE));
}

// ── Track animation helpers ───────────────────────────────────────────────────
interface FruitRunner {
  id: string;
  emoji: string;
  name: string;
  color: string;
  track: string;
  pos: number;       // 0..1 progress
  speed: number;     // current speed multiplier
  baseSpeed: number; // nominal speed
  wobble: number;
  winner: boolean;
}

function initRunners(fruits: typeof FRUITS): FruitRunner[] {
  return fruits.map(f => ({
    ...f,
    pos: 0,
    speed: 0.004 + Math.random() * 0.003,
    baseSpeed: 0.004 + Math.random() * 0.003,
    wobble: Math.random() * Math.PI * 2,
    winner: false,
  }));
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function FruitRoll() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();
  const wallet = publicKey?.toBase58() || null;

  // Game config
  const [fruitCount, setFruitCount] = useState(4);
  const [pickedFruit, setPickedFruit] = useState<string | null>(null);
  const [betAmount, setBetAmount] = useState('');
  const [betError, setBetError] = useState('');
  const [betLoading, setBetLoading] = useState(false);

  // Race state
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'racing' | 'result'>('idle');
  const [countdown, setCountdown] = useState(3);
  const [runners, setRunners] = useState<FruitRunner[]>([]);
  const [winnerFruit, setWinnerFruit] = useState<FruitRunner | null>(null);
  const [playerWon, setPlayerWon] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState(0);
  const [recentResults, setRecentResults] = useState<{ emoji: string; name: string; won: boolean; payout: number }[]>([]);
  const [isGameLocked, setIsGameLocked] = useState(false);
  const raceRef = useRef<number | null>(null);
  const runnersRef = useRef<FruitRunner[]>([]);
  const winnerPendingRef = useRef<string | null>(null);  // fruiid of pre-determined winner

  // Claim state
  const [socket, setSocket] = useState<Socket | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [claimId, setClaimId] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<'registering' | 'ready' | 'claiming' | 'success' | 'error' | null>(null);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [claimError, setClaimError] = useState('');
  const [unclaimedTotal, setUnclaimedTotal] = useState(0);
  const claimInFlight = useRef(false);
  const currentBetSigRef = useRef<string | null>(null);

  const selectedFruits = FRUITS.slice(0, fruitCount);
  const betLamports = Math.floor(parseFloat(betAmount || '0') * LAMPORTS_PER_SOL);
  const potentialPayout = betLamports > 0 ? getPayout(fruitCount, betLamports) : 0;
  const potentialPayoutSol = (potentialPayout / LAMPORTS_PER_SOL).toFixed(4);
  const multiplier = (fruitCount * (1 - HOUSE_EDGE)).toFixed(2);

  // ── Start race ──────────────────────────────────────────────────────────────
  const startRace = useCallback((predeterminedWinner: string) => {
    winnerPendingRef.current = predeterminedWinner;
    const fresh = initRunners(selectedFruits);
    runnersRef.current = fresh;
    setRunners(fresh);
    setWinnerFruit(null);
    setPhase('countdown');
    setCountdown(3);
    let c = 3;
    const cInt = setInterval(() => {
      c--;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(cInt);
        setPhase('racing');
        runRace();
      }
    }, 1000);
  }, [selectedFruits]);

  const runRace = useCallback(() => {
    const FINISH = 1.0;
    let tick = 0;

    const animate = () => {
      tick++;
      const targetWinner = winnerPendingRef.current;

      setRunners(prev => {
        const updated = prev.map(r => {
          let newPos = r.pos;
          let newSpeed = r.speed;

          // Natural speed variation
          const wobble = Math.sin(tick * 0.05 + r.wobble) * 0.002;
          newSpeed = r.baseSpeed + wobble;

          // If this fruit is the predetermined winner, don't throttle near finish
          const isWinner = r.id === targetWinner;

          // Non-winners: slow down aggressively and hard-cap before finish line
          if (!isWinner) {
            if (newPos > 0.90) {
              newSpeed *= 0.3;
            } else if (newPos > 0.80) {
              newSpeed *= 0.55;
            }
          }

          // Winner: slight burst in final stretch
          if (isWinner && newPos > 0.7) {
            newSpeed *= 1.08;
          }

          // Hard cap: non-winners cannot cross the finish line
          const cap = isWinner ? FINISH : 0.97;
          newPos = Math.min(newPos + newSpeed, cap);

          return { ...r, pos: newPos, speed: newSpeed };
        });
        runnersRef.current = updated;
        return updated;
      });

      // Check if predetermined winner crossed finish
      const current = runnersRef.current;
      const winner = current.find(r => r.id === targetWinner && r.pos >= FINISH);
      if (winner) {
        if (raceRef.current) cancelAnimationFrame(raceRef.current);
        // Mark winner visually
        setRunners(prev => prev.map(r => ({ ...r, winner: r.id === winner.id })));
        setWinnerFruit(winner);
        setPhase('result');
        return;
      }

      raceRef.current = requestAnimationFrame(animate);
    };

    raceRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    return () => { if (raceRef.current) cancelAnimationFrame(raceRef.current); };
  }, []);

  // When winner is determined, settle result
  useEffect(() => {
    if (phase === 'result' && winnerFruit) {
      const won = winnerFruit.id === pickedFruit;
      setPlayerWon(won);
      const payout = won ? potentialPayout : 0;
      setPayoutAmount(payout);
      setRecentResults(prev => [
        { emoji: winnerFruit.emoji, name: winnerFruit.name, won, payout },
        ...prev.slice(0, 9),
      ]);
      // If the player won, register the win with the server so we can do a claim
      if (won && wallet && socket && currentBetSigRef.current && betLamports > 0) {
        setClaimState('registering');
        setClaimId(null);
        setClaimTx(null);
        setClaimError('');
        claimInFlight.current = false;
        socket.emit('register_fruitroll_win', {
          wallet,
          betTxSig: currentBetSigRef.current,
          betLamports,
          fruitCount,
        });
      }
    }
  }, [phase, winnerFruit, socket, wallet, betLamports, fruitCount, potentialPayout, pickedFruit]);

  // Subscribe to mod game lock events
  useEffect(() => {
    const s = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'https://fruitbowl.fun', { transports: ['websocket', 'polling'] });
    s.on('locked_games', (games: string[]) => {
      setIsGameLocked(games.includes('fruitroll'));
    });
    s.on('fruitroll_win_registered', (res: { success: boolean; claimId?: string; payoutLamports?: number; error?: string; alreadyRegistered?: boolean }) => {
      if (res.success && res.claimId) {
        setClaimId(res.claimId);
        setClaimState('ready');
        // Persist locally in case page refreshes before claim
        if (wallet) {
          try {
            const pending = JSON.parse(localStorage.getItem(`fr_pending_claim_${wallet}`) || '{}');
            pending[res.claimId] = { payoutLamports: res.payoutLamports, registeredAt: Date.now() };
            localStorage.setItem(`fr_pending_claim_${wallet}`, JSON.stringify(pending));
          } catch {}
        }
      } else {
        setClaimState('error');
        setClaimError(res.error || 'Failed to register win — please try claiming from Settings');
      }
    });
    s.on('fruitroll_claim_result', (res: { success: boolean; claimTx?: string; amount?: number; error?: string; alreadyClaimed?: boolean }) => {
      claimInFlight.current = false;
      if (res.success || res.alreadyClaimed) {
        setClaimState('success');
        setClaimTx(res.claimTx || null);
        // Refresh unclaimed count
        s.emit('get_unclaimed_wins', { wallet });
      } else {
        setClaimState('error');
        setClaimError(res.error || 'Claim failed — please try again');
      }
    });
    s.on('unclaimed_wins', (data: { items: any[]; totalLamports: number }) => {
      setUnclaimedTotal(data.totalLamports || 0);
    });
    s.emit('get_state');
    if (wallet) s.emit('get_unclaimed_wins', { wallet });
    setSocket(s);
    return () => { s.disconnect(); };
  }, [wallet]);

  // ── Handle Bet ──────────────────────────────────────────────────────────────
  const handleBet = async () => {
    setBetError('');
    if (!wallet || !publicKey) { setBetError('Connect your wallet first.'); return; }
    if (isGameLocked) { setBetError('This game has been locked by a moderator.'); return; }
    if (!pickedFruit) { setBetError('Pick a fruit first!'); return; }
    if (!HOUSE_WALLET) { setBetError('House wallet not configured.'); return; }
    const sol = parseFloat(betAmount);
    if (isNaN(sol) || sol < 0.001) { setBetError('Minimum bet is 0.001 SOL'); return; }
    if (phase !== 'idle') { setBetError('Race already in progress!'); return; }

    setBetLoading(true);
    try {
      const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
      const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
      const expectedNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'mainnet-beta';
      const expectedGenesis = expectedNetwork === 'devnet' ? DEVNET_GENESIS : MAINNET_GENESIS;
      const expectedName = expectedNetwork === 'devnet' ? 'Devnet' : 'Mainnet';

      // Detect the wallet's actual cluster by querying its own RPC endpoint.
      // useConnection() always returns the site's RPC (mainnet), NOT the wallet's network,
      // so we pull the wallet adapter's rpcEndpoint directly and create a fresh Connection.
      const walletRpc: string =
        (window as any).phantom?.solana?.connection?._rpcEndpoint ||
        (window as any).solana?.connection?._rpcEndpoint ||
        (window as any).backpack?.connection?._rpcEndpoint ||
        connection.rpcEndpoint; // final fallback to site RPC
      const { Connection: SolConnection } = await import('@solana/web3.js');
      const walletConnection = new SolConnection(walletRpc, 'confirmed');
      const genesis = await walletConnection.getGenesisHash();
      if (genesis !== expectedGenesis) {
        const wrongName = genesis === DEVNET_GENESIS ? 'Devnet' : genesis === MAINNET_GENESIS ? 'Mainnet' : 'Unknown network';
        setBetError(`❌ Switch your wallet to ${expectedName} — you're currently on ${wrongName}.`);
        setBetLoading(false); return;
      }

      const balance = await connection.getBalance(publicKey);
      const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
      if (lamports + 5000 > balance) { setBetError('Insufficient balance.'); setBetLoading(false); return; }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new PublicKey(HOUSE_WALLET),
        lamports,
      }));
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection, { skipPreflight: false, preflightCommitment: 'confirmed' });

      // Wait for confirmation
      setBetError('⏳ Confirming transaction...');
      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const status = await connection.getSignatureStatus(sig, { searchTransactionHistory: false });
        const conf = status?.value?.confirmationStatus;
        if (status?.value?.err) { setBetError('Transaction failed on-chain.'); setBetLoading(false); return; }
        if (conf === 'confirmed' || conf === 'finalized') { confirmed = true; break; }
        const currentSlot = await connection.getSlot();
        if (currentSlot > lastValidBlockHeight) { setBetError('Transaction expired — please try again.'); setBetLoading(false); return; }
      }
      if (!confirmed) { setBetError('Transaction timed out — please try again.'); setBetLoading(false); return; }

      setBetError('');

      // Store bet sig for win registration
      currentBetSigRef.current = sig;

      // Determine winner — check mod override first
      const alwaysLose = (() => { try { return localStorage.getItem('mod_fruitroll_always_lose') === 'true'; } catch { return false; } })();
      let determinedWinner: string;
      if (alwaysLose) {
        // Mod override: always pick a non-picked fruit
        const losers = selectedFruits.filter(f => f.id !== pickedFruit);
        determinedWinner = losers[Math.floor(Math.random() * losers.length)].id;
      } else {
        // Fair 1/N odds but we keep 5% house edge by adjusting payout not odds
        const winChance = 1 / fruitCount;
        const rand = Math.random();
        if (rand < winChance) {
          // Player wins
          determinedWinner = pickedFruit!;
        } else {
          // House wins — pick a random non-picked fruit
          const losers = selectedFruits.filter(f => f.id !== pickedFruit);
          determinedWinner = losers[Math.floor(Math.random() * losers.length)].id;
        }
      }

      setBetLoading(false);
      startRace(determinedWinner);
    } catch (e: any) {
      setBetError(e.message?.includes('rejected') || e.message?.includes('cancelled') ? 'Transaction cancelled.' : e.message || 'Transaction failed.');
      setBetLoading(false);
    }
  };

  const resetGame = () => {
    setPhase('idle');
    setWinnerFruit(null);
    // Keep pickedFruit so user's selection persists across rounds
    setPlayerWon(false);
    setPayoutAmount(0);
    setRunners([]);
    runnersRef.current = [];
    winnerPendingRef.current = null;
    currentBetSigRef.current = null;
    setClaimId(null);
    setClaimState(null);
    setClaimTx(null);
    setClaimError('');
    claimInFlight.current = false;
  };

  // ── Track widths / layout ─────────────────────────────────────────────────
  const TRACK_H = 54;
  const TRACK_GAP = 8;
  const FRUIT_SIZE = 36;

  return (
    <>
      <Head>
        <title>FruitRoll — FruitBowl.fun</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

        {/* ── HEADER ── */}
        <header style={{
          display: 'flex', alignItems: 'center', height: '58px', flexShrink: 0,
          background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)',
          padding: '0 20px', gap: '16px',
        }}>
          <div
            onClick={() => router.push('/')}
            style={{ display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer' }}
          >
            <span style={{ fontSize: '26px', lineHeight: 1 }}>🍓</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', color: '#e53e3e', letterSpacing: '-0.01em' }}>
              FruitBowl<span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>.fun</span>
            </span>
          </div>

          <nav style={{ display: 'flex', alignItems: 'center', height: '100%', marginLeft: '8px' }}>
            {/* Orangepot */}
            <div
              onClick={() => router.push('/')}
              style={{
                height: '100%', display: 'flex', alignItems: 'center', padding: '0 16px',
                borderBottom: '2px solid transparent', color: 'var(--text-muted)',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px',
                cursor: 'pointer', letterSpacing: '0.01em', transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'rgba(255,140,0,0.6)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'transparent'; }}
            >🍊 Orangepot</div>

            {/* FruitRoll — active */}
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', padding: '0 16px',
              borderBottom: '2px solid #48bb78',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px',
              cursor: 'pointer', letterSpacing: '0.01em',
            }}>🍉 FruitRoll</div>

            {/* Referrals */}
            <div
              onClick={() => router.push('/referral')}
              style={{
                height: '100%', display: 'flex', alignItems: 'center', padding: '0 16px',
                borderBottom: '2px solid transparent', color: 'var(--text-muted)',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px',
                cursor: 'pointer', letterSpacing: '0.01em', transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'rgba(167,139,250,0.6)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'transparent'; }}
            >🔗 Referrals</div>
          </nav>

          <div style={{ flex: 1 }} />
          {wallet && (
            <button
              onClick={() => setShowSettings(true)}
              title="Settings"
              style={{
                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
                borderRadius: '8px', color: 'var(--text-muted)', cursor: 'pointer',
                width: '34px', height: '34px', fontSize: '16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'background 0.15s',
              }}
            >⚙️</button>
          )}
          <WalletMultiButton />
        </header>

        {/* ── UNCLAIMED WINNINGS BANNER ── */}
        {wallet && unclaimedTotal > 0 && (
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              background: 'linear-gradient(90deg, rgba(16,185,129,0.15), rgba(16,185,129,0.08), rgba(16,185,129,0.15))',
              borderBottom: '1px solid rgba(16,185,129,0.35)',
              padding: '9px 20px',
              cursor: 'default',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '16px' }}>💰</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: '#10b981', letterSpacing: '0.04em' }}>
              You have <strong>{(unclaimedTotal / 1_000_000_000).toFixed(4)} SOL</strong> in unclaimed winnings —
            </span>
            <span
              onClick={() => router.push('/')}
              style={{ fontSize: '11px', color: 'rgba(16,185,129,0.7)', fontFamily: 'var(--font-display)', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' }}
            >
              Claim in Settings →
            </span>
          </div>
        )}

        {/* ── BODY ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── LEFT: Controls ── */}
          <div style={{
            width: '300px', flexShrink: 0,
            borderRight: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto', padding: '20px 16px', gap: '16px',
          }}>

            {/* Title */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '4px' }}>🍉</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '22px', color: 'var(--text-primary)' }}>FruitRoll</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Pick a fruit · Watch the race · Win big</div>
            </div>

            {/* Fruit count selector */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '14px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: '10px' }}>
                NUMBER OF FRUITS
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[2, 3, 4, 5, 6].map(n => (
                  <button
                    key={n}
                    onClick={() => { setFruitCount(n); setPickedFruit(null); }}
                    disabled={phase !== 'idle'}
                    style={{
                      flex: 1, padding: '8px 0',
                      borderRadius: '8px', border: '1px solid',
                      borderColor: fruitCount === n ? '#48bb78' : 'var(--border-color)',
                      background: fruitCount === n ? 'rgba(72,187,120,0.15)' : 'rgba(255,255,255,0.03)',
                      color: fruitCount === n ? '#48bb78' : 'var(--text-muted)',
                      fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px',
                      cursor: phase !== 'idle' ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >{n}</button>
                ))}
              </div>
              <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
                Win multiplier: <span style={{ color: '#48bb78', fontWeight: 700 }}>{multiplier}×</span>
              </div>
            </div>

            {/* Pick your fruit */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '14px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: '10px' }}>
                PICK YOUR FRUIT
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {selectedFruits.map(f => (
                  <button
                    key={f.id}
                    onClick={() => phase === 'idle' && setPickedFruit(f.id)}
                    disabled={phase !== 'idle'}
                    style={{
                      padding: '12px 8px',
                      borderRadius: '10px', border: '2px solid',
                      borderColor: pickedFruit === f.id ? f.color : 'var(--border-color)',
                      background: pickedFruit === f.id ? `${f.color}20` : 'rgba(255,255,255,0.02)',
                      cursor: phase !== 'idle' ? 'not-allowed' : 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                      transition: 'all 0.15s',
                      boxShadow: pickedFruit === f.id ? `0 0 12px ${f.color}40` : 'none',
                    }}
                  >
                    <span style={{ fontSize: '22px' }}>{f.emoji}</span>
                    <span style={{ fontSize: '10px', fontFamily: 'var(--font-display)', fontWeight: 700, color: pickedFruit === f.id ? f.color : 'var(--text-muted)' }}>{f.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Bet amount */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '14px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: '10px' }}>
                BET AMOUNT
              </div>
              <div style={{
                display: 'flex', alignItems: 'center',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                borderRadius: '10px', padding: '0 14px', height: '46px', gap: '10px',
              }}>
                <span style={{ fontSize: '18px' }}>🍊</span>
                <input
                  type="number" value={betAmount} onChange={e => setBetAmount(e.target.value)}
                  min="0.001" step="0.001" placeholder="0.1"
                  disabled={phase !== 'idle'}
                  style={{
                    flex: 1, background: 'transparent', border: 'none',
                    color: 'var(--text-primary)', fontFamily: 'var(--font-display)',
                    fontWeight: 700, fontSize: '17px', outline: 'none', padding: 0,
                  }}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'Space Mono, monospace' }}>SOL</span>
              </div>
              {/* Quick bets */}
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                {['0.1', '0.25', '0.5', '1'].map(v => (
                  <button key={v} onClick={() => setBetAmount(v)} disabled={phase !== 'idle'}
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: '6px', border: '1px solid var(--border-color)',
                      background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)',
                      fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', cursor: 'pointer',
                    }}>{v}</button>
                ))}
              </div>
              {betLamports > 0 && (
                <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Potential win: <span style={{ color: '#48bb78', fontWeight: 700 }}>+{potentialPayoutSol} SOL</span>
                </div>
              )}
            </div>

            {/* Roll button */}
            {isGameLocked && (
              <div style={{ marginBottom: '10px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '10px', fontSize: '12px', color: '#f87171', fontFamily: 'var(--font-display)', fontWeight: 700, textAlign: 'center', letterSpacing: '0.04em' }}>
                🔒 THIS GAME HAS BEEN LOCKED BY A MODERATOR
              </div>
            )}
            {phase === 'idle' ? (
              !wallet ? (
                <WalletMultiButton style={{ width: '100%', height: '50px', borderRadius: '12px', fontSize: '14px', fontFamily: 'var(--font-display)', fontWeight: 700 }} />
              ) : (
                <button
                  onClick={handleBet}
                  disabled={betLoading || !pickedFruit || !betAmount || isGameLocked}
                  style={{
                    width: '100%', height: '50px', borderRadius: '12px', border: 'none',
                    background: isGameLocked ? 'rgba(239,68,68,0.15)' : pickedFruit ? `linear-gradient(135deg, ${selectedFruits.find(f=>f.id===pickedFruit)?.color || '#48bb78'}cc, ${selectedFruits.find(f=>f.id===pickedFruit)?.color || '#48bb78'})` : 'rgba(255,255,255,0.07)',
                    color: isGameLocked ? '#f87171' : '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '16px',
                    cursor: (betLoading || !pickedFruit || !betAmount || isGameLocked) ? 'not-allowed' : 'pointer',
                    opacity: (!pickedFruit || !betAmount || isGameLocked) ? 0.5 : 1,
                    transition: 'all 0.2s',
                    letterSpacing: '0.05em',
                  }}
                >
                  {isGameLocked ? '🔒 Game Locked' : betLoading ? '⏳ Confirming...' : `🎰 Roll It!`}
                </button>
              )
            ) : phase === 'result' ? (
              <button
                onClick={resetGame}
                style={{
                  width: '100%', height: '50px', borderRadius: '12px', border: 'none',
                  background: 'linear-gradient(135deg,#cc5500,#ff8c00)',
                  color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px',
                  cursor: 'pointer', letterSpacing: '0.05em',
                }}
              >🔄 Play Again</button>
            ) : (
              <div style={{
                height: '50px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: 'var(--text-muted)',
              }}>🏁 Race in progress...</div>
            )}

            {betError && (
              <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', fontSize: '12px', color: '#f87171' }}>
                {betError}
              </div>
            )}

            {/* How it works */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '14px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: '10px' }}>HOW IT WORKS</div>
              {[
                ['🍉', 'Choose 2–6 fruits in the race'],
                ['🎯', 'Pick your winning fruit'],
                ['💰', 'Set your bet amount'],
                ['🏁', 'Watch the marble race!'],
                ['🏆', `Win (N-1)× your bet · 5% fee`],
              ].map(([icon, text]) => (
                <div key={text as string} style={{ display: 'flex', gap: '8px', marginBottom: '7px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '12px', flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── CENTER: Race track ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '24px', position: 'relative' }}>

            {/* Countdown overlay */}
            {phase === 'countdown' && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
              }}>
                <div style={{
                  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '120px',
                  color: '#48bb78',
                  filter: 'drop-shadow(0 0 12px rgba(72,187,120,0.95)) drop-shadow(0 0 30px rgba(72,187,120,0.7)) drop-shadow(0 0 60px rgba(72,187,120,0.4)) drop-shadow(0 0 100px rgba(72,187,120,0.15))',
                  animation: 'pulse-glow 0.5s ease-in-out infinite',
                  lineHeight: 1,
                  background: 'transparent',
                }}>
                  {countdown > 0 ? countdown : 'GO!'}
                </div>
              </div>
            )}

            {/* Result overlay */}
            {phase === 'result' && winnerFruit && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)',
              }}>
                <div style={{
                  textAlign: 'center',
                  background: 'linear-gradient(145deg,#0d0520,#13082a)',
                  border: `2px solid ${playerWon ? '#48bb78' : '#ef4444'}`,
                  borderRadius: '24px', padding: '48px 56px',
                  boxShadow: `0 0 80px ${playerWon ? 'rgba(72,187,120,0.4)' : 'rgba(239,68,68,0.3)'}`,
                }}>
                  <div style={{ fontSize: '64px', marginBottom: '8px' }}>{winnerFruit.emoji}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '32px', color: playerWon ? '#48bb78' : '#f87171', marginBottom: '8px', textShadow: `0 0 30px ${playerWon ? 'rgba(72,187,120,0.6)' : 'rgba(248,113,113,0.6)'}` }}>
                    {playerWon ? '🎉 YOU WIN!' : '😔 Better Luck!'}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                    {winnerFruit.name} wins the race!
                  </div>
                  {playerWon && (
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '42px', color: '#48bb78', textShadow: '0 0 24px rgba(72,187,120,0.4)', marginBottom: '8px' }}>
                      +{(payoutAmount / LAMPORTS_PER_SOL).toFixed(4)} ◎
                    </div>
                  )}
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '24px' }}>
                    {playerWon ? `${multiplier}× multiplier · 5% fee deducted` : `You picked: ${selectedFruits.find(f => f.id === pickedFruit)?.emoji} ${selectedFruits.find(f => f.id === pickedFruit)?.name}`}
                  </div>

                  {/* ── Claim section (winner only) ── */}
                  {playerWon && (
                    <div style={{ marginBottom: '16px' }}>
                      {claimState === 'success' ? (
                        <div style={{ padding: '14px', background: 'rgba(72,187,120,0.12)', border: '1px solid rgba(72,187,120,0.4)', borderRadius: '12px', marginBottom: '10px' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', color: '#48bb78', marginBottom: '4px' }}>
                            ✅ Prize Sent!
                          </div>
                          {claimTx && (
                            <a href={`https://explorer.solana.com/tx/${claimTx}`} target="_blank" rel="noreferrer"
                              style={{ fontSize: '11px', color: '#48bb78', textDecoration: 'underline', fontFamily: 'Space Mono, monospace' }}>
                              View on Explorer ↗
                            </a>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            if (claimInFlight.current || claimState === 'claiming' || claimState === 'registering' || !claimId || !socket || !wallet) return;
                            claimInFlight.current = true;
                            setClaimState('claiming');
                            setClaimError('');
                            socket.emit('claim_fruitroll_payout', { wallet, claimId });
                          }}
                          disabled={!claimId || claimState === 'claiming' || claimState === 'registering'}
                          style={{
                            display: 'block', width: '100%', padding: '16px',
                            borderRadius: '12px', border: 'none',
                            cursor: (!claimId || claimState === 'claiming' || claimState === 'registering') ? 'not-allowed' : 'pointer',
                            background: (!claimId || claimState === 'claiming' || claimState === 'registering')
                              ? 'rgba(255,255,255,0.08)'
                              : 'linear-gradient(135deg,#48bb78,#38a169)',
                            color: '#fff',
                            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '17px',
                            letterSpacing: '0.04em',
                            boxShadow: claimId && claimState === 'ready' ? '0 0 28px rgba(72,187,120,0.45)' : 'none',
                            transition: 'all 0.2s',
                            opacity: (!claimId || claimState === 'claiming' || claimState === 'registering') ? 0.65 : 1,
                            marginBottom: '8px',
                          }}
                        >
                          {claimState === 'registering' ? '⏳ Registering win...' :
                           claimState === 'claiming' ? '⏳ Sending...' :
                           claimState === 'error' ? `💰 Retry Claim` :
                           claimId ? `💰 Claim ${(payoutAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL` :
                           '⏳ Preparing claim...'}
                        </button>
                      )}
                      {claimState === 'error' && claimError && (
                        <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', fontSize: '11px', color: '#f87171', marginTop: '6px' }}>
                          {claimError}
                        </div>
                      )}
                      {!claimId && claimState !== 'registering' && claimState !== 'error' && (
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
                          If claim doesn't appear, check Settings → Unclaimed Winnings
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={resetGame} style={{
                    padding: '14px 40px', borderRadius: '12px', border: 'none',
                    background: 'linear-gradient(135deg,#cc5500,#ff8c00)',
                    color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px',
                    cursor: 'pointer', letterSpacing: '0.05em',
                  }}>🔄 Play Again</button>
                </div>
              </div>
            )}

            {/* Idle state — show empty tracks */}
            {phase === 'idle' && (
              <div style={{ width: '100%', maxWidth: '700px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', paddingRight: '2px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>START</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>FINISH 🏁</span>
                </div>
                {selectedFruits.map((fruit, idx) => {
                  const isMyFruit = fruit.id === pickedFruit;
                  return (
                    <div key={fruit.id} style={{ marginBottom: idx < selectedFruits.length - 1 ? `${TRACK_GAP}px` : 0 }}>
                      <div style={{
                        height: `${TRACK_H}px`, borderRadius: '12px', position: 'relative',
                        background: fruit.track,
                        border: `1px solid ${isMyFruit ? `${fruit.color}60` : 'var(--border-color)'}`,
                        boxShadow: isMyFruit ? `0 0 20px ${fruit.color}50, 0 0 40px ${fruit.color}20` : 'none',
                        transition: 'box-shadow 0.3s',
                      }}>
                        {/* Track lane lines */}
                        <div style={{ position: 'absolute', inset: 0, borderRadius: '12px', backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 49px, rgba(255,255,255,0.03) 49px, rgba(255,255,255,0.03) 50px)` }} />
                        {/* Finish line */}
                        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '3px', borderRadius: '0 12px 12px 0', background: 'rgba(255,255,255,0.15)', borderRight: '2px dashed rgba(255,255,255,0.1)' }} />
                        {/* Player indicator */}
                        {isMyFruit && (
                          <div style={{
                            position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                            fontSize: '8px', fontFamily: 'var(--font-display)', fontWeight: 700,
                            color: fruit.color, letterSpacing: '0.08em', opacity: 0.7,
                          }}>YOUR BET</div>
                        )}
                        {/* Fruit sitting at start */}
                        <div style={{
                          position: 'absolute',
                          left: `${FRUIT_SIZE / 2}px`,
                          top: '50%', transform: 'translateY(-50%)',
                          fontSize: `${FRUIT_SIZE}px`, lineHeight: 1,
                          filter: isMyFruit ? `drop-shadow(0 0 6px ${fruit.color})` : 'none',
                          opacity: 0.7,
                        }}>
                          {fruit.emoji}
                        </div>
                        {/* Fruit name label */}
                        <div style={{
                          position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                          fontSize: '10px', fontFamily: 'var(--font-display)', fontWeight: 700,
                          color: 'var(--text-muted)', opacity: 0.4,
                        }}>{fruit.name}</div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop: '16px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.1em', opacity: 0.6 }}>
                    {pickedFruit ? '🎯 Ready — place your bet and roll!' : '👈 Pick a fruit to get started'}
                  </div>
                </div>
              </div>
            )}

            {/* Race tracks */}
            {(phase === 'racing' || phase === 'countdown' || phase === 'result') && runners.length > 0 && (
              <div style={{ width: '100%', maxWidth: '700px' }}>
                {/* Finish line label */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', paddingRight: '2px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>START</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>FINISH 🏁</span>
                </div>

                {runners.map((runner, idx) => {
                  const isMyFruit = runner.id === pickedFruit;
                  const isWinner = phase === 'result' && runner.winner;
                  return (
                    <div key={runner.id} style={{ marginBottom: idx < runners.length - 1 ? `${TRACK_GAP}px` : 0 }}>
                      <div style={{
                        height: `${TRACK_H}px`, borderRadius: '12px', position: 'relative',
                        background: runner.track,
                        border: `1px solid ${isMyFruit ? `${runner.color}60` : 'var(--border-color)'}`,
                        boxShadow: isMyFruit
                          ? `0 0 20px ${runner.color}50, 0 0 40px ${runner.color}20`
                          : isWinner
                          ? `0 0 24px ${runner.color}60, 0 0 48px ${runner.color}30`
                          : 'none',
                        transition: 'box-shadow 0.3s',
                      }}>
                        {/* Track lane lines */}
                        <div style={{ position: 'absolute', inset: 0, borderRadius: '12px', backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 49px, rgba(255,255,255,0.03) 49px, rgba(255,255,255,0.03) 50px)` }} />

                        {/* Finish line */}
                        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '3px', background: 'rgba(255,255,255,0.15)', borderRight: '2px dashed rgba(255,255,255,0.1)' }} />

                        {/* Player indicator */}
                        {isMyFruit && (
                          <div style={{
                            position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                            fontSize: '8px', fontFamily: 'var(--font-display)', fontWeight: 700,
                            color: runner.color, letterSpacing: '0.08em', opacity: 0.7,
                          }}>YOUR BET</div>
                        )}

                        {/* Winner glow */}
                        {isWinner && (
                          <div style={{ position: 'absolute', inset: 0, background: `${runner.color}15`, animation: 'pulse-glow 0.5s ease-in-out infinite' }} />
                        )}

                        {/* Fruit runner */}
                        <div style={{
                          position: 'absolute',
                          left: `calc(${runner.pos * 100}% - ${FRUIT_SIZE / 2}px)`,
                          top: '50%', transform: 'translateY(-50%)',
                          fontSize: `${FRUIT_SIZE}px`, lineHeight: 1,
                          transition: phase === 'result' ? 'none' : undefined,
                          filter: isWinner
                            ? `drop-shadow(0 0 6px ${runner.color}) drop-shadow(0 0 12px ${runner.color}99) drop-shadow(0 0 20px ${runner.color}55)`
                            : isMyFruit
                            ? `drop-shadow(0 0 4px ${runner.color}cc) drop-shadow(0 0 8px ${runner.color}66)`
                            : undefined,
                          animation: phase === 'racing' && runner.pos < 0.95 ? `fruit-bounce-${idx} 0.3s ease-in-out infinite` : undefined,
                        }}>
                          {runner.emoji}
                        </div>

                        {/* Fruit name label */}
                        <div style={{
                          position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                          fontSize: '10px', fontFamily: 'var(--font-display)', fontWeight: 700,
                          color: 'var(--text-muted)', opacity: 0.4,
                        }}>{runner.name}</div>
                      </div>
                    </div>
                  );
                })}

                {/* Race progress bar */}
                {phase === 'racing' && (
                  <div style={{ marginTop: '16px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                      RACE IN PROGRESS
                      <span style={{ marginLeft: '8px', animation: 'winner-flash 0.6s infinite' }}>🏁</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT: Recent results ── */}
          <div style={{
            width: '220px', flexShrink: 0, borderLeft: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', overflowY: 'auto',
          }}>
            <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>RECENT RESULTS</div>
            </div>
            <div style={{ padding: '10px', flex: 1 }}>
              {recentResults.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                  🏁<br />No races yet
                </div>
              ) : recentResults.map((r, i) => (
                <div key={i} style={{
                  background: 'var(--bg-card)', border: `1px solid ${r.won ? 'rgba(72,187,120,0.2)' : 'var(--border-color)'}`,
                  borderRadius: '8px', padding: '10px', marginBottom: '8px',
                  animation: i === 0 ? 'recentRoundIn 0.4s ease forwards' : 'none',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '18px' }}>{r.emoji}</span>
                    <span style={{ fontSize: '10px', fontFamily: 'var(--font-display)', fontWeight: 700, color: r.won ? '#48bb78' : '#f87171' }}>
                      {r.won ? 'WIN' : 'LOSS'}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>{r.name}</div>
                  {r.won && (
                    <div style={{ fontSize: '11px', color: '#48bb78', fontWeight: 700, marginTop: '2px' }}>
                      +{(r.payout / LAMPORTS_PER_SOL).toFixed(4)} ◎
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Stats */}
            <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '8px' }}>PAYOUTS</div>
              {[2,3,4,5,6].map(n => (
                <div key={n} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{n} fruits</span>
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--orange-soft)' }}>
                    {(n * (1 - HOUSE_EDGE)).toFixed(2)}×
                  </span>
                </div>
              ))}
              <div style={{ marginTop: '10px', fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
                FruitBowl.fun · 5% house edge
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fruit-bounce-0 { 0%,100%{transform:translateY(-50%) rotate(-5deg)} 50%{transform:translateY(-60%) rotate(5deg)} }
        @keyframes fruit-bounce-1 { 0%,100%{transform:translateY(-50%) rotate(3deg)} 50%{transform:translateY(-58%) rotate(-3deg)} }
        @keyframes fruit-bounce-2 { 0%,100%{transform:translateY(-50%) rotate(-4deg)} 50%{transform:translateY(-62%) rotate(4deg)} }
        @keyframes fruit-bounce-3 { 0%,100%{transform:translateY(-50%) rotate(6deg)} 50%{transform:translateY(-55%) rotate(-6deg)} }
        @keyframes fruit-bounce-4 { 0%,100%{transform:translateY(-50%) rotate(-3deg)} 50%{transform:translateY(-60%) rotate(3deg)} }
        @keyframes fruit-bounce-5 { 0%,100%{transform:translateY(-50%) rotate(4deg)} 50%{transform:translateY(-57%) rotate(-4deg)} }
        @keyframes pulse-glow {
          0%,100% { filter: drop-shadow(0 0 12px rgba(72,187,120,0.95)) drop-shadow(0 0 30px rgba(72,187,120,0.7)) drop-shadow(0 0 60px rgba(72,187,120,0.4)) drop-shadow(0 0 100px rgba(72,187,120,0.15)); opacity: 1; }
          50%     { filter: drop-shadow(0 0 20px rgba(72,187,120,1))    drop-shadow(0 0 50px rgba(72,187,120,0.85)) drop-shadow(0 0 90px rgba(72,187,120,0.55)) drop-shadow(0 0 140px rgba(72,187,120,0.25)); opacity: 0.9; }
        }
      `}</style>
      {showSettings && wallet && (
        <SettingsModal
          wallet={wallet}
          currentDisplayName={displayName}
          socket={socket}
          onClose={() => setShowSettings(false)}
          onUsernameChanged={(name) => { setDisplayName(name); setShowSettings(false); }}
        />
      )}
    </>
  );
}

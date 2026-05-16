import React, { useEffect, useState, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { io, Socket } from 'socket.io-client';
import {
  Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import OrangeWheel from '../components/OrangeWheel';
import Chat from '../components/Chat';
import PlayerList from '../components/PlayerList';
import Countdown from '../components/Countdown';
import WinnerOverlay from '../components/WinnerOverlay';
import UsernameModal from '../components/UsernameModal';

// ─── HOUSE WALLET ────────────────────────────────────────────────────────────
const HOUSE_WALLET = 'REPLACE_WITH_YOUR_HOUSE_WALLET_ADDRESS';
// ─────────────────────────────────────────────────────────────────────────────

interface Player {
  wallet: string;
  displayName: string;
  betAmount: number;
  percentage: number;
  color: string;
}

interface GameRound {
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

interface WinnerInfo {
  winnerWallet: string;
  winnerDisplayName: string;
  winnerShare: number;
  totalPot: number;
}

interface RecentRound {
  id: string;
  winnerDisplayName: string;
  winnerWallet: string;
  winnerShare: number;
  totalPot: number;
  winnerChance: number;
  endedAt: number;
}

const QUICK_BETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1];

export default function Home() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [round, setRound] = useState<GameRound | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [winnerInfo, setWinnerInfo] = useState<WinnerInfo | null>(null);
  const [showWinner, setShowWinner] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [recentRounds, setRecentRounds] = useState<RecentRound[]>([]);
  const [betAmount, setBetAmount] = useState('0.1');
  const [betLoading, setBetLoading] = useState(false);
  const [betError, setBetError] = useState('');
  const [betTx, setBetTx] = useState('');
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const prevWalletRef = useRef<string | null>(null);

  const wallet = publicKey?.toBase58() || null;

  // Username modal on connect
  useEffect(() => {
    if (wallet && !prevWalletRef.current) {
      const stored = localStorage.getItem(`username_${wallet}`);
      if (stored) { setDisplayName(stored); }
      else { setShowUsernameModal(true); }
    }
    if (!wallet) { setShowUsernameModal(false); }
    prevWalletRef.current = wallet;
  }, [wallet]);

  // Socket
  useEffect(() => {
    const s = io('https://casino.wsamcserver.xyz', { transports: ['websocket', 'polling'] });
    s.on('connect', () => { setConnected(true); s.emit('get_state'); });
    s.on('disconnect', () => setConnected(false));
    s.on('round_update', (r: GameRound) => { setRound(r); setIsSpinning(r.status === 'spinning'); });
    s.on('spin_started', () => setIsSpinning(true));
    s.on('winner_announced', (info: WinnerInfo) => {
      setWinnerInfo(info);
      setShowWinner(true);
      setIsSpinning(false);
      // Add to recent rounds
      setRecentRounds(prev => [{
        id: Date.now().toString(),
        winnerDisplayName: info.winnerDisplayName,
        winnerWallet: info.winnerWallet,
        winnerShare: info.winnerShare,
        totalPot: info.totalPot,
        winnerChance: 0,
        endedAt: Date.now(),
      }, ...prev].slice(0, 10));
    });
    s.on('new_round', () => { setIsSpinning(false); setWinnerInfo(null); });
    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  useEffect(() => {
    if (!wallet || !socket || !displayName) return;
    socket.emit('register_user', { wallet, displayName });
  }, [wallet, socket, displayName]);

  const handleUsernameConfirm = useCallback((name: string) => {
    setDisplayName(name);
    setShowUsernameModal(false);
    if (wallet) {
      localStorage.setItem(`username_${wallet}`, name);
      fetch('/api/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet, displayName: name }) }).catch(console.error);
      if (socket) socket.emit('register_user', { wallet, displayName: name });
    }
  }, [wallet, socket]);

  const handleBet = async () => {
    if (!wallet || !publicKey || !socket) return;
    setBetError(''); setBetTx('');
    if (HOUSE_WALLET === 'REPLACE_WITH_YOUR_HOUSE_WALLET_ADDRESS') { setBetError('House wallet not configured.'); return; }
    const sol = parseFloat(betAmount);
    if (isNaN(sol) || sol < 0.01) { setBetError('Minimum bet is 0.01 SOL'); return; }
    const status = round?.status || 'waiting';
    if (status === 'spinning' || status === 'ended') { setBetError('Round is closed'); return; }
    setBetLoading(true);
    try {
      const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(HOUSE_WALLET), lamports }));
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      setBetTx(sig);
      socket.emit('place_bet', { wallet, displayName: displayName || wallet.slice(0, 8), amountLamports: lamports, txSignature: sig });
    } catch (e: any) {
      setBetError(e.message?.includes('rejected') || e.message?.includes('cancelled') ? 'Transaction cancelled' : e.message || 'Transaction failed');
    }
    setBetLoading(false);
  };

  const myPlayer = round?.players.find(p => p.wallet === wallet);
  const myBet = myPlayer?.betAmount || 0;
  const myChance = myPlayer?.percentage || 0;
  const potSol = round ? (round.totalPot / 1_000_000_000).toFixed(4) : '0.0000';
  const myBetSol = (myBet / 1_000_000_000).toFixed(4);
  const isAcceptingBets = (round?.status === 'waiting' || round?.status === 'active');

  const shortWallet = wallet ? wallet.slice(0, 4) + '…' + wallet.slice(-4) : '';

  return (
    <>
      <Head>
        <title>FruitBowl.fun — Solana Jackpot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {showUsernameModal && wallet && (
        <UsernameModal wallet={wallet} onConfirm={handleUsernameConfirm} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

        {/* ── HEADER ── */}
        <header style={{
          display: 'flex', alignItems: 'center', height: '58px', flexShrink: 0,
          background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)',
          padding: '0 20px', gap: '16px',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ fontSize: '26px', lineHeight: 1 }}>🍊</span>
            <span style={{
              fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px',
              color: 'var(--orange-bright)', letterSpacing: '-0.01em',
            }}>FruitBowl<span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>.fun</span></span>
          </div>

          {/* Nav */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '2px', height: '100%', marginLeft: '8px' }}>
            {[
              { label: '🎯 Jackpot', active: true },
              { label: '📊 Affiliates', active: false },
              { label: '⚖️ Provably Fair', active: false },
            ].map(({ label, active }) => (
              <div key={label} style={{
                height: '100%', display: 'flex', alignItems: 'center',
                padding: '0 16px',
                borderBottom: active ? '2px solid var(--orange-bright)' : '2px solid transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px',
                cursor: 'pointer', transition: 'color 0.15s', letterSpacing: '0.01em',
              }}>{label}</div>
            ))}
          </nav>

          {/* Weekly leaderboard */}
          <div style={{
            marginLeft: '8px',
            background: 'linear-gradient(135deg,rgba(255,140,0,0.12),rgba(255,180,0,0.08))',
            border: '1px solid rgba(255,140,0,0.25)',
            borderRadius: '8px', padding: '5px 14px',
            fontSize: '12px', color: 'var(--orange-soft)',
            fontFamily: 'var(--font-display)', fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
          }}>
            🏆 $10,000 WEEKLY LEADERBOARD
          </div>

          <div style={{ flex: 1 }} />

          {/* Timer pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)',
            borderRadius: '8px', padding: '5px 12px',
            fontFamily: 'Space Mono, monospace', fontSize: '13px', color: 'var(--text-secondary)',
            letterSpacing: '0.05em',
          }}>
            ⏱ {round?.status === 'active' && round.countdownEndsAt
              ? Math.max(0, Math.ceil((round.countdownEndsAt - Date.now()) / 1000)).toString().padStart(2, '0') + ':00'
              : '--:--'}
          </div>

          {/* Live dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#10b981' : '#ef4444', boxShadow: connected ? '0 0 8px #10b981' : 'none' }} />
          </div>

          {/* User badge */}
          {wallet && displayName && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'rgba(255,140,0,0.08)', border: '1px solid rgba(255,140,0,0.2)',
              borderRadius: '8px', padding: '5px 12px',
              fontSize: '12px', color: 'var(--orange-soft)',
              fontFamily: 'var(--font-display)', fontWeight: 700,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: 'linear-gradient(135deg,var(--orange-glow),var(--orange-soft))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', color: '#fff', fontWeight: 800,
              }}>{displayName.charAt(0).toUpperCase()}</div>
              {displayName}
            </div>
          )}

          <WalletMultiButton />
        </header>

        {/* ── STAT BAR (solpot style) ── */}
        <div style={{
          display: 'flex', alignItems: 'stretch', flexShrink: 0,
          background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)',
          height: '56px',
        }}>
          {[
            { label: 'Jackpot Value', value: `🍊 ${potSol}`, accent: true },
            { label: 'Your Wager',    value: `◎ ${myBetSol}` },
            { label: 'Your Chance',   value: myChance > 0 ? myChance.toFixed(2) + '%' : '0.00%' },
            { label: 'Time Remaining', value: round?.status === 'active' && round.countdownEndsAt
              ? `${Math.floor(Math.max(0,(round.countdownEndsAt - Date.now())/1000)/60).toString().padStart(2,'0')}:${(Math.max(0,Math.ceil((round.countdownEndsAt - Date.now())/1000)) % 60).toString().padStart(2,'0')}`
              : '00 : 00' },
          ].map(({ label, value, accent }, i, arr) => (
            <div key={label} style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              borderRight: i < arr.length - 1 ? '1px solid var(--border-color)' : 'none',
              background: accent ? 'rgba(255,107,0,0.04)' : 'transparent',
              padding: '0 12px',
            }}>
              <div style={{
                fontSize: '18px', fontFamily: 'var(--font-display)', fontWeight: 700,
                color: accent ? 'var(--orange-bright)' : 'var(--text-primary)',
                letterSpacing: '-0.01em', lineHeight: 1,
              }}>{value}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.06em', marginTop: '3px' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── MAIN BODY ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

          {/* Chat toggle button (left edge) */}
          <button
            onClick={() => setChatOpen(!chatOpen)}
            style={{
              position: 'absolute', left: chatOpen ? '260px' : '0', top: '50%',
              transform: 'translateY(-50%)', zIndex: 50,
              background: 'var(--bg-card)', border: '1px solid var(--border-color)',
              borderLeft: 'none', borderRadius: '0 8px 8px 0',
              padding: '14px 6px', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: '16px',
              transition: 'left 0.3s ease', display: 'flex', alignItems: 'center',
            }}
          >
            {chatOpen ? '‹' : '💬'}
          </button>

          {/* Chat panel */}
          <div style={{
            width: chatOpen ? '260px' : '0', minWidth: chatOpen ? '260px' : '0',
            transition: 'all 0.3s ease', overflow: 'hidden', flexShrink: 0,
            borderRight: chatOpen ? '1px solid var(--border-color)' : 'none',
          }}>
            <Chat socket={socket} currentWallet={wallet} currentDisplayName={displayName} isConnected={connected} />
          </div>

          {/* ── CENTER: wheel + bet input ── */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'flex-start',
            padding: '20px 24px', gap: '0', overflowY: 'auto',
          }}>

            {/* Bet input row — centered above wheel, like solpot */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px', padding: '10px 16px',
              marginBottom: '12px', width: '100%', maxWidth: '540px',
            }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>
                BET AMOUNT
              </span>

              {/* SOL input */}
              <div style={{ display: 'flex', alignItems: 'center', flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0 12px', height: '40px' }}>
                <span style={{ fontSize: '16px', marginRight: '6px' }}>🍊</span>
                <input
                  type="number"
                  value={betAmount}
                  onChange={e => setBetAmount(e.target.value)}
                  min="0.01" step="0.01"
                  style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', outline: 'none', padding: 0, boxShadow: 'none' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'Space Mono, monospace' }}>SOL</span>
              </div>

              {/* +0.1 quick add */}
              <button
                onClick={() => setBetAmount(prev => (parseFloat(prev || '0') + 0.1).toFixed(2))}
                style={{
                  padding: '0 14px', height: '40px', background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-color)', borderRadius: '8px',
                  color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 700,
                  fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >+0.1</button>

              {/* Place bet */}
              <button
                onClick={handleBet}
                disabled={betLoading || !wallet || !isAcceptingBets || !connected}
                className="btn-orange"
                style={{ padding: '0 22px', height: '40px', fontSize: '14px', letterSpacing: '0.04em', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {betLoading ? '⏳ Confirming...' : !wallet ? 'Connect Wallet' : !isAcceptingBets ? '🔒 Closed' : 'Place Bet'}
              </button>
            </div>

            {/* Quick bet chips */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
              {QUICK_BETS.map(amt => (
                <button key={amt} onClick={() => setBetAmount(String(amt))}
                  style={{
                    padding: '5px 12px', fontSize: '11px',
                    background: betAmount === String(amt) ? 'rgba(255,107,0,0.18)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${betAmount === String(amt) ? 'rgba(255,107,0,0.5)' : 'var(--border-color)'}`,
                    borderRadius: '20px',
                    color: betAmount === String(amt) ? 'var(--orange-soft)' : 'var(--text-muted)',
                    cursor: 'pointer', fontFamily: 'Space Mono, monospace', transition: 'all 0.15s',
                  }}
                >{amt}◎</button>
              ))}
            </div>

            {/* Error / success */}
            {betError && (
              <div style={{ marginBottom: '10px', padding: '8px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', fontSize: '12px', color: '#f87171', maxWidth: '540px', width: '100%' }}>
                {betError}
              </div>
            )}
            {betTx && (
              <div style={{ marginBottom: '10px', padding: '8px 14px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', fontSize: '12px', color: '#10b981', maxWidth: '540px', width: '100%' }}>
                ✓ Bet placed! <a href={`https://explorer.solana.com/tx/${betTx}`} target="_blank" rel="noreferrer" style={{ color: '#10b981', textDecoration: 'underline' }}>View tx ↗</a>
              </div>
            )}

            {/* Wheel */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              {/* Pointer */}
              <div style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
                <div style={{ width: 0, height: 0, borderLeft: '10px solid transparent', borderRight: '10px solid transparent', borderTop: '18px solid var(--orange-bright)', filter: 'drop-shadow(0 0 8px rgba(255,140,0,0.9))' }} />
              </div>
              {isSpinning && (
                <div style={{ position: 'absolute', width: 404, height: 404, borderRadius: '50%', border: '3px solid transparent', borderTopColor: 'var(--orange-bright)', borderRightColor: 'var(--orange-soft)', animation: 'spin-jackpot 0.5s linear infinite', zIndex: 0 }} />
              )}
              <div style={{ position: 'relative', zIndex: 1 }}>
                <OrangeWheel players={round?.players || []} totalPot={round?.totalPot || 0} isSpinning={isSpinning} winnerWallet={round?.winnerWallet || null} size={360} />
              </div>
            </div>

            {/* Status / countdown */}
            <div style={{ width: '100%', maxWidth: '540px', marginBottom: '12px' }}>
              <Countdown endsAt={round?.countdownEndsAt || null} status={round?.status || 'waiting'} />
            </div>

            {/* Player list */}
            <div style={{ width: '100%', maxWidth: '540px' }}>
              <PlayerList players={round?.players || []} totalPot={round?.totalPot || 0} winnerWallet={round?.winnerWallet || null} currentWallet={wallet} />
            </div>
          </div>

          {/* ── RIGHT PANEL: recent rounds ── */}
          <div style={{
            width: '240px', flexShrink: 0,
            borderLeft: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
          }}>
            {/* Current round header */}
            <div style={{
              padding: '12px 14px', borderBottom: '1px solid var(--border-color)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>ROUND</span>
              <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>
                #{round?.id?.slice(0, 6) || '------'}
              </span>
            </div>

            {/* Current round winner if ended */}
            {round?.winnerWallet && (
              <div style={{
                margin: '12px', background: 'var(--bg-card)',
                border: '1px solid rgba(255,107,0,0.2)', borderRadius: '10px', padding: '12px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '32px', marginBottom: '6px' }}>
                  {['🍊','🍋','🍇','🍓','🍍','🥭'][Math.floor(Math.random() * 6)]}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', color: 'var(--orange-soft)', marginBottom: '2px' }}>
                  {round.winnerDisplayName}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px', background: 'rgba(255,107,0,0.1)', padding: '2px 8px', borderRadius: '4px', display: 'inline-block' }}>
                  LAST WINNER
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Won</span>
                  <span style={{ color: 'var(--orange-soft)', fontWeight: 700 }}>◎ {(round.winnerShare / 1e9).toFixed(3)}</span>
                </div>
              </div>
            )}

            {/* Recent rounds list */}
            <div style={{ padding: '0 14px 8px', flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '8px', marginTop: '8px' }}>
                RECENT ROUNDS
              </div>
              {recentRounds.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0', lineHeight: 1.8 }}>
                  🍊<br />No rounds yet
                </div>
              ) : recentRounds.map((r, i) => (
                <div key={r.id} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                  borderRadius: '8px', padding: '10px', marginBottom: '8px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{r.winnerDisplayName}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>#{i + 1}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Won</span>
                    <span style={{ color: 'var(--orange-soft)', fontWeight: 700 }}>◎ {(r.winnerShare / 1e9).toFixed(3)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginTop: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Pot</span>
                    <span style={{ color: 'var(--text-secondary)' }}>◎ {(r.totalPot / 1e9).toFixed(3)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* How it works footer */}
            <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '8px' }}>HOW IT WORKS</div>
              {[['🍊','Buy in with SOL'],['⏳','60s countdown'],['🎰','Weighted spin'],['🏆','95% to winner']].map(([icon, text]) => (
                <div key={text} style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px' }}>{icon}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{text}</span>
                </div>
              ))}
              <div style={{ marginTop: '10px', fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
                FruitBowl.fun · 5% house edge
              </div>
            </div>
          </div>
        </div>
      </div>

      {showWinner && winnerInfo && (
        <WinnerOverlay
          winnerWallet={winnerInfo.winnerWallet}
          winnerDisplayName={winnerInfo.winnerDisplayName}
          winnerShare={winnerInfo.winnerShare}
          totalPot={winnerInfo.totalPot}
          isYou={winnerInfo.winnerWallet === wallet}
          onClose={() => { setShowWinner(false); setWinnerInfo(null); }}
        />
      )}
    </>
  );
}

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
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
import SettingsModal from '../components/SettingsModal';

const HOUSE_WALLET = process.env.NEXT_PUBLIC_HOUSE_WALLET || '';

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
  roundId: string;
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

type MobileTab = 'game' | 'chat' | 'history' | 'settings';

export default function Home() {
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const { connection } = useConnection();
  const router = useRouter();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [round, setRound] = useState<GameRound | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [winnerInfo, setWinnerInfo] = useState<WinnerInfo | null>(null);
  const [showWinner, setShowWinner] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [recentRounds, setRecentRounds] = useState<RecentRound[]>([]);
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [betAmount, setBetAmount] = useState('');
  const [betLoading, setBetLoading] = useState(false);
  const [betError, setBetError] = useState('');
  const [betTx, setBetTx] = useState('');
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [roundDisplayId, setRoundDisplayId] = useState(1);
  const [pendingBet, setPendingBet] = useState<{wallet:string;displayName:string;amountLamports:number;txSignature:string}|null>(null);
  const [isGameLocked, setIsGameLocked] = useState(false);
  const prevWalletRef = useRef<string | null>(null);
  const prevRoundIdRef = useRef<string | null>(null);
  const [liveTimeLeft, setLiveTimeLeft] = useState<number>(0);
  const [lastAnimatedRoundId, setLastAnimatedRoundId] = useState<string | null>(null);
  const [unclaimedTotal, setUnclaimedTotal] = useState<number>(0);
  const [mobileTab, setMobileTab] = useState<MobileTab>('game');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const tick = () => {
      if (round?.status === 'active' && round.countdownEndsAt) {
        setLiveTimeLeft(Math.max(0, Math.ceil((round.countdownEndsAt - Date.now()) / 1000)));
      } else {
        setLiveTimeLeft(0);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [round?.status, round?.countdownEndsAt]);

  const wallet = publicKey?.toBase58() || null;

  useEffect(() => {
    if (wallet && !prevWalletRef.current) {
      const stored = localStorage.getItem(`username_${wallet}`);
      if (stored) { setDisplayName(stored); }
      else { setShowUsernameModal(true); }
      const refParam = router.query.ref;
      if (refParam && typeof refParam === 'string' && refParam !== wallet && socket) {
        socket.emit('register_referral', { referredWallet: wallet, referrerWallet: refParam });
      }
    }
    if (!wallet) { setShowUsernameModal(false); }
    prevWalletRef.current = wallet;
  }, [wallet, socket, router.query.ref]);

  useEffect(() => {
    const s = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'https://fruitbowl.fun', { transports: ['websocket', 'polling'] });
    s.on('connect', () => { setConnected(true); s.emit('get_state'); });
    s.on('disconnect', () => setConnected(false));
    s.on('round_update', (r: GameRound) => {
      if (r.id !== prevRoundIdRef.current) {
        if (prevRoundIdRef.current !== null) setRoundDisplayId(prev => prev + 1);
        prevRoundIdRef.current = r.id;
      }
      setRound(r);
      setIsSpinning(r.status === 'spinning');
    });
    s.on('spin_started', () => setIsSpinning(true));
    s.on('recent_rounds', (rounds: RecentRound[]) => {
      setRecentRounds(rounds);
      if (rounds.length > 0) setLastAnimatedRoundId(rounds[0].id);
    });
    s.on('winner_announced', (info: WinnerInfo) => {
      setWinnerInfo(info);
      setShowWinner(true);
      setIsSpinning(false);
    });
    s.on('username_changed', ({ wallet: changedWallet, newName }: { wallet: string; newName: string }) => {
      if (changedWallet === publicKey?.toBase58()) setDisplayName(newName);
    });
    s.on('avatar_updated', ({ wallet: aw, avatar }: { wallet: string; avatar: string | null }) => {
      setAvatarMap(prev => ({ ...prev, [aw]: avatar || '' }));
    });
    s.on('new_round', () => {
      setIsSpinning(false);
      setRoundDisplayId(prev => prev + 1);
      setPendingBet(prev => {
        if (prev) {
          s.emit('place_bet', prev);
          setBetError('');
          setBetTx('Queued bet placed in new round!');
        }
        return null;
      });
    });
    s.on('locked_games', (games: string[]) => {
      setIsGameLocked(games.includes('fruitbowl'));
    });
    s.on('unclaimed_wins', (data: { items: any[]; totalLamports: number }) => {
      setUnclaimedTotal(data.totalLamports || 0);
    });
    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  useEffect(() => {
    if (!wallet || !socket || !displayName) return;
    socket.emit('register_user', { wallet, displayName });
    socket.emit('get_unclaimed_wins', { wallet });
  }, [wallet, socket, displayName]);

  const handleUsernameConfirm = useCallback((name: string, referralCode?: string) => {
    setDisplayName(name);
    setShowUsernameModal(false);
    if (wallet) {
      localStorage.setItem(`username_${wallet}`, name);
      if (referralCode && !localStorage.getItem(`referredBy_${wallet}`)) {
        localStorage.setItem(`referredBy_${wallet}`, referralCode);
        if (socket) socket.emit('register_referral', { referredWallet: wallet, referrerWallet: referralCode });
      }
      fetch('/api/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet, displayName: name }) }).catch(console.error);
      if (socket) socket.emit('register_user', { wallet, displayName: name });
    }
  }, [wallet, socket]);

  const handleBet = async () => {
    if (!wallet || !publicKey || !socket) return;
    setBetError(''); setBetTx('');
    if (!HOUSE_WALLET) { setBetError('House wallet not configured.'); return; }
    const sol = parseFloat(betAmount);
    if (isNaN(sol) || sol < 0.001) { setBetError('Minimum bet is 0.001 SOL'); return; }
    const status = round?.status || 'waiting';
    if (status === 'spinning' || status === 'ended') { setBetError('Round is closed'); return; }
    setBetLoading(true);
    try {
      const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
      const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
      const expectedNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'mainnet-beta';
      const expectedGenesis = expectedNetwork === 'devnet' ? DEVNET_GENESIS : MAINNET_GENESIS;
      const expectedName = expectedNetwork === 'devnet' ? 'Devnet' : 'Mainnet';
      const walletRpc: string =
        (window as any).phantom?.solana?.connection?._rpcEndpoint ||
        (window as any).solana?.connection?._rpcEndpoint ||
        (window as any).backpack?.connection?._rpcEndpoint ||
        connection.rpcEndpoint;
      const { Connection: SolConnection } = await import('@solana/web3.js');
      const walletConnection = new SolConnection(walletRpc, 'confirmed');
      const genesis = await walletConnection.getGenesisHash();
      if (genesis !== expectedGenesis) {
        const wrongName = genesis === DEVNET_GENESIS ? 'Devnet' : genesis === MAINNET_GENESIS ? 'Mainnet' : 'Unknown network';
        setBetError(`Switch your wallet to ${expectedName} — you're currently on ${wrongName}.`);
        setBetLoading(false);
        return;
      }

      const balance = await connection.getBalance(publicKey);
      const fee = 5000;
      const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
      if (lamports + fee > balance) { setBetError('Insufficient balance to cover bet + network fee'); setBetLoading(false); return; }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(HOUSE_WALLET), lamports }));
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const sig = await sendTransaction(tx, connection, { skipPreflight: false, preflightCommitment: 'confirmed' });

      setBetError('Waiting for transaction to confirm...');
      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const status = await connection.getSignatureStatus(sig, { searchTransactionHistory: false });
        const conf = status?.value?.confirmationStatus;
        const err = status?.value?.err;
        if (err) {
          setBetError('Transaction failed on-chain. Please try again.');
          setBetLoading(false);
          return;
        }
        if (conf === 'confirmed' || conf === 'finalized') {
          confirmed = true;
          break;
        }
        const currentSlot = await connection.getSlot();
        if (currentSlot > lastValidBlockHeight) {
          setBetError('Transaction expired before confirming — please try again.');
          setBetLoading(false);
          return;
        }
      }
      if (!confirmed) {
        setBetError('Transaction did not confirm in time — please try again.');
        setBetLoading(false);
        return;
      }

      setBetError('');
      setBetTx(sig);
      const currentStatus = round?.status;
      if (currentStatus === 'spinning') {
        setPendingBet({ wallet, displayName: displayName || wallet.slice(0, 8), amountLamports: lamports, txSignature: sig });
        setBetError('Round is spinning — your bet is queued for the next round!');
      } else {
        socket.emit('place_bet', { wallet, displayName: displayName || wallet.slice(0, 8), amountLamports: lamports, txSignature: sig, gameType: 'fruitbowl' });
      }
    } catch (e: any) {
      setBetError(e.message?.includes('rejected') || e.message?.includes('cancelled') ? 'Transaction cancelled' : e.message || 'Transaction failed');
    }
    setBetLoading(false);
  };

  const myPlayer = round?.players.find(p => p.wallet === wallet);
  const myBet = myPlayer?.betAmount || 0;
  const myChance = myPlayer?.percentage || 0;
  const potSol = round ? (round.totalPot / 1_000_000_000).toFixed(3) : '0.000';
  const myBetSol = (myBet / 1_000_000_000).toFixed(3);
  const isAcceptingBets = (round?.status === 'waiting' || round?.status === 'active') && !isGameLocked;
  const isIdleSpinning = isAcceptingBets && !isSpinning;

  const statCards = [
    { label: 'Orangepot', value: potSol, icon: '◎', accent: true },
    { label: 'My Wager', value: myBetSol, icon: '◎', accent: false },
    { label: 'My Chance', value: myChance > 0 ? myChance.toFixed(1) + '%' : '—', icon: null, accent: false },
    { label: 'Time Left', value: round?.status === 'active' && round.countdownEndsAt
        ? `${Math.floor(liveTimeLeft / 60).toString().padStart(2,'0')}:${(liveTimeLeft % 60).toString().padStart(2,'0')}`
        : '—', icon: null, accent: false },
  ];

  const BetPanel = () => (
    <div style={{
      width: '100%',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '16px',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '11px 18px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(255,107,0,0.04)',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.12em' }}>PLACE BET</span>
        <span style={{ fontSize: '10px', color: isAcceptingBets ? '#10b981' : '#ef4444', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isAcceptingBets ? '#10b981' : '#ef4444', display: 'inline-block', boxShadow: isAcceptingBets ? '0 0 6px #10b981' : '0 0 6px #ef4444' }} />
          {isAcceptingBets ? 'OPEN' : 'CLOSED'}
        </span>
      </div>

      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0 14px', height: '50px', gap: '10px' }}>
          <span style={{ fontSize: '20px', flexShrink: 0 }}>🍊</span>
          <input
            type="number"
            value={betAmount}
            onChange={e => setBetAmount(e.target.value)}
            min="0.001" step="0.001"
            placeholder="0.1"
            inputMode="decimal"
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '18px', outline: 'none', padding: 0, boxShadow: 'none', width: '100%' }}
          />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'Space Mono, monospace', flexShrink: 0 }}>SOL</span>
        </div>

        {!wallet ? (
          <WalletMultiButton style={{ height: '50px', borderRadius: '10px', fontSize: '13px', padding: '0 16px', whiteSpace: 'nowrap', background: 'linear-gradient(135deg,#cc5500,#ff8c00)', fontFamily: 'var(--font-display)', fontWeight: 700, flexShrink: 0 }} />
        ) : (
          <button
            onClick={handleBet}
            disabled={betLoading || !isAcceptingBets || !connected}
            className="btn-orange"
            style={{ padding: '0 20px', height: '50px', fontSize: '15px', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderRadius: '10px', flexShrink: 0 }}
          >
            {betLoading ? '⏳' : isGameLocked ? '🔒' : !isAcceptingBets ? '🔒 Closed' : 'Bet Now'}
          </button>
        )}
      </div>

      <div style={{ padding: '0 18px 12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {['0.05', '0.1', '0.25', '0.5', '1'].map(amt => (
          <button
            key={amt}
            onClick={() => setBetAmount(amt)}
            style={{
              background: betAmount === amt ? 'rgba(255,107,0,0.2)' : 'rgba(255,255,255,0.04)',
              border: betAmount === amt ? '1px solid rgba(255,107,0,0.5)' : '1px solid var(--border-color)',
              borderRadius: '6px', padding: '4px 10px',
              color: betAmount === amt ? 'var(--orange-soft)' : 'var(--text-muted)',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {amt}
          </button>
        ))}
      </div>

      {isGameLocked && (
        <div style={{ margin: '0 18px 12px', padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', fontSize: '12px', color: '#f87171', fontFamily: 'var(--font-display)', fontWeight: 700, textAlign: 'center', letterSpacing: '0.04em' }}>
          🔒 THIS GAME HAS BEEN LOCKED BY A MODERATOR
        </div>
      )}
      {betError && (
        <div style={{ margin: '0 18px 12px', padding: '8px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', fontSize: '12px', color: '#f87171' }}>
          {betError}
        </div>
      )}
      {betTx && (
        <div style={{ margin: '0 18px 12px', padding: '8px 14px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', fontSize: '12px', color: '#10b981' }}>
          Bet placed! <a href={`https://explorer.solana.com/tx/${betTx}`} target="_blank" rel="noreferrer" style={{ color: '#10b981', textDecoration: 'underline' }}>View tx</a>
        </div>
      )}
    </div>
  );

  const HistoryPanel = () => (
    <div style={{ padding: '14px', overflowY: 'auto', flex: 1 }}>
      {winnerInfo && !isSpinning && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,107,0,0.2)', borderRadius: '12px', padding: '14px', textAlign: 'center', marginBottom: '14px' }}>
          <div style={{ fontSize: '32px', marginBottom: '6px' }}>🏆</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: 'var(--orange-soft)', marginBottom: '4px' }}>{winnerInfo.winnerDisplayName}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'rgba(255,107,0,0.1)', padding: '2px 10px', borderRadius: '4px', display: 'inline-block', marginBottom: '8px' }}>LAST WINNER</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Pot</span>
            <span style={{ color: 'var(--orange-soft)', fontWeight: 700 }}>◎ {(winnerInfo.totalPot / 1e9).toFixed(3)}</span>
          </div>
        </div>
      )}

      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '10px' }}>RECENT ROUNDS</div>
      {recentRounds.length === 0 ? (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0', lineHeight: 1.8 }}>
          🍊<br />No rounds yet
        </div>
      ) : recentRounds.map((r, i) => (
        <div key={r.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', marginBottom: '8px', animation: r.id === lastAnimatedRoundId ? 'recentRoundIn 0.5s ease forwards' : 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{r.winnerDisplayName}</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>#{i + 1}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Pot</span>
            <span style={{ color: 'var(--orange-soft)', fontWeight: 700 }}>◎ {(r.totalPot / 1e9).toFixed(3)}</span>
          </div>
        </div>
      ))}

      <div style={{ marginTop: '12px', padding: '12px 14px', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '8px' }}>HOW IT WORKS</div>
        {[['🍊','Buy in with SOL'],['⏳','60s countdown'],['🎰','Weighted spin'],['🏆','95% to winner']].map(([icon, text]) => (
          <div key={text as string} style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px' }}>{icon}</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4 }}>{text}</span>
          </div>
        ))}
        <div style={{ marginTop: '10px', fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>FruitBowl.fun · 5% house edge</div>
      </div>
    </div>
  );

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <Head>
          <title>FruitBowl.fun — Solana Orangepot</title>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        </Head>

        {showUsernameModal && wallet && (
          <UsernameModal wallet={wallet} socket={socket} onConfirm={handleUsernameConfirm} />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

          {/* MOBILE HEADER */}
          <header style={{ display: 'flex', alignItems: 'center', height: '52px', flexShrink: 0, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', padding: '0 14px', gap: '10px' }}>
            <span style={{ fontSize: '22px', lineHeight: 1 }}>🍓</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '16px', color: '#e53e3e', letterSpacing: '-0.01em', flex: 1 }}>
              FruitBowl<span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>.fun</span>
            </span>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#10b981' : '#ef4444', boxShadow: connected ? '0 0 8px #10b981' : 'none', flexShrink: 0 }} />
            <WalletMultiButton style={{ height: '34px', borderRadius: '8px', fontSize: '11px', padding: '0 10px', background: 'linear-gradient(135deg,#cc5500,#ff8c00)', fontFamily: 'var(--font-display)', fontWeight: 700, flexShrink: 0 }} />
          </header>

          {/* UNCLAIMED BANNER */}
          {wallet && unclaimedTotal > 0 && (
            <div onClick={() => { setShowSettings(true); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'linear-gradient(90deg, rgba(16,185,129,0.15), rgba(16,185,129,0.08), rgba(16,185,129,0.15))', borderBottom: '1px solid rgba(16,185,129,0.35)', padding: '7px 14px', cursor: 'pointer', flexShrink: 0 }}>
              <span style={{ fontSize: '14px' }}>💰</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: '#10b981' }}>{(unclaimedTotal / 1_000_000_000).toFixed(4)} SOL unclaimed — Tap to claim →</span>
            </div>
          )}

          {/* MOBILE STAT BAR (only on game tab) */}
          {mobileTab === 'game' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', flexShrink: 0, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)', padding: '8px 10px', gap: '8px' }}>
              {statCards.map(({ label, value, icon, accent }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: accent ? 'linear-gradient(135deg, rgba(255,107,0,0.1), rgba(255,140,0,0.05))' : 'rgba(255,255,255,0.03)', border: accent ? '1px solid rgba(255,107,0,0.35)' : '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '8px 4px' }}>
                  <div style={{ fontSize: '13px', fontFamily: 'var(--font-display)', fontWeight: 700, color: accent ? 'var(--orange-bright)' : 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1, display: 'flex', alignItems: 'center', gap: '2px' }}>
                    {icon && <span style={{ fontSize: '9px', opacity: 0.7 }}>{icon}</span>}
                    {value}
                  </div>
                  <div style={{ fontSize: '8px', color: 'var(--text-muted)', letterSpacing: '0.04em', marginTop: '3px', fontFamily: 'var(--font-display)', fontWeight: 600, textAlign: 'center' }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* TAB CONTENT */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {mobileTab === 'game' && (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 14px 8px' }}>
                <div style={{ width: '100%', maxWidth: '500px', marginBottom: '14px' }}>
                  <BetPanel />
                </div>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                  <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
                    <div style={{ width: 0, height: 0, borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: '14px solid var(--orange-bright)', filter: 'drop-shadow(0 0 6px rgba(255,140,0,0.9))' }} />
                  </div>
                  {isSpinning && (
                    <div style={{ position: 'absolute', width: 294, height: 294, borderRadius: '50%', border: '3px solid transparent', borderTopColor: 'var(--orange-bright)', borderRightColor: 'var(--orange-soft)', animation: 'spin-jackpot 0.5s linear infinite', zIndex: 0 }} />
                  )}
                  <div style={{ position: 'relative', zIndex: 1 }}>
                    <OrangeWheel players={round?.players || []} totalPot={round?.totalPot || 0} isSpinning={isSpinning} isIdleSpinning={isIdleSpinning} winnerWallet={round?.winnerWallet || null} size={270} avatarMap={avatarMap} />
                  </div>
                </div>
                <div style={{ width: '100%', maxWidth: '500px', marginBottom: '10px' }}>
                  <Countdown endsAt={round?.countdownEndsAt || null} status={round?.status || 'waiting'} />
                </div>
                <div style={{ width: '100%', maxWidth: '500px', marginBottom: '20px' }}>
                  <PlayerList players={round?.players || []} totalPot={round?.totalPot || 0} winnerWallet={round?.winnerWallet || null} currentWallet={wallet} />
                </div>
              </div>
            )}

            {mobileTab === 'chat' && (
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <Chat socket={socket} currentWallet={wallet} currentDisplayName={displayName} isConnected={connected} isMod={wallet === '9QeT88EePX6w7DsTWe5Tpx9s5go6QfxrUtpxtFeznfxi'} />
              </div>
            )}

            {mobileTab === 'history' && (
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '14px', overflowY: 'auto', flex: 1 }}>
                  {winnerInfo && !isSpinning && (
                    <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,107,0,0.2)', borderRadius: '12px', padding: '16px', textAlign: 'center', marginBottom: '14px' }}>
                      <div style={{ fontSize: '36px', marginBottom: '8px' }}>🏆</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--orange-soft)', marginBottom: '4px' }}>{winnerInfo.winnerDisplayName}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'rgba(255,107,0,0.1)', padding: '2px 10px', borderRadius: '4px', display: 'inline-block', marginBottom: '10px' }}>LAST WINNER</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Pot</span>
                        <span style={{ color: 'var(--orange-soft)', fontWeight: 700 }}>◎ {(winnerInfo.totalPot / 1e9).toFixed(3)}</span>
                      </div>
                    </div>
                  )}
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '12px' }}>RECENT ROUNDS</div>
                  {recentRounds.length === 0 ? (
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0', lineHeight: 2 }}>🍊<br />No rounds yet</div>
                  ) : recentRounds.map((r, i) => (
                    <div key={r.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px', marginBottom: '10px', animation: r.id === lastAnimatedRoundId ? 'recentRoundIn 0.5s ease forwards' : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '13px', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{r.winnerDisplayName}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>#{i + 1}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Pot</span>
                        <span style={{ color: 'var(--orange-soft)', fontWeight: 700 }}>◎ {(r.totalPot / 1e9).toFixed(3)}</span>
                      </div>
                      {r.winnerChance > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '4px' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Win chance</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{r.winnerChance?.toFixed(1)}%</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mobileTab === 'settings' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '12px' }}>GAMES</div>
                  {[{ label: '🍊 Orangepot', path: '/', active: true }, { label: '🍉 FruitRoll', path: '/fruitroll', active: false }, { label: '🔗 Referrals', path: '/referral', active: false }].map(item => (
                    <div key={item.path} onClick={() => router.push(item.path)} style={{ display: 'flex', alignItems: 'center', padding: '16px', marginBottom: '8px', background: item.active ? 'rgba(255,107,0,0.1)' : 'var(--bg-card)', border: item.active ? '1px solid rgba(255,107,0,0.3)' : '1px solid var(--border-color)', borderRadius: '12px', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: item.active ? 'var(--orange-soft)' : 'var(--text-primary)' }}>
                      {item.label}
                      <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '18px' }}>›</span>
                    </div>
                  ))}
                </div>

                {wallet && (
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '12px' }}>ACCOUNT</div>
                    {displayName && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', marginBottom: '12px' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,var(--orange-glow),var(--orange-soft))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: '#fff', fontWeight: 800, flexShrink: 0 }}>{displayName.charAt(0).toUpperCase()}</div>
                        <div>
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>{displayName}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'Space Mono, monospace', marginTop: '2px' }}>{wallet.slice(0, 8)}...{wallet.slice(-6)}</div>
                        </div>
                      </div>
                    )}
                    <button onClick={() => setShowSettings(true)} className="btn-orange" style={{ width: '100%', padding: '16px', fontSize: '14px', borderRadius: '12px', letterSpacing: '0.04em' }}>
                      ⚙️ Account Settings
                    </button>
                  </div>
                )}

                {!wallet && (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px', fontFamily: 'var(--font-display)' }}>Connect your wallet to play</div>
                    <WalletMultiButton />
                  </div>
                )}

                <div style={{ padding: '16px', background: 'rgba(255,107,0,0.04)', border: '1px solid rgba(255,107,0,0.12)', borderRadius: '12px', marginBottom: '20px' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '10px' }}>HOW IT WORKS</div>
                  {[['🍊','Buy in with any amount of SOL'],['⏳','60 second countdown timer'],['🎰','Weighted spin — bigger bet = higher chance'],['🏆','95% of the pot goes to the winner']].map(([icon, text]) => (
                    <div key={text as string} style={{ display: 'flex', gap: '12px', marginBottom: '10px', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '16px', flexShrink: 0 }}>{icon}</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{text}</span>
                    </div>
                  ))}
                </div>

                <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', paddingBottom: '20px' }}>
                  FruitBowl.fun · 5% house edge · Solana
                </div>
              </div>
            )}
          </div>

          {/* MOBILE BOTTOM NAV */}
          <nav style={{ display: 'flex', alignItems: 'stretch', height: '60px', flexShrink: 0, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)' }}>
            {([
              { tab: 'game' as MobileTab, label: 'Game', icon: '🍊' },
              { tab: 'chat' as MobileTab, label: 'Chat', icon: '💬' },
              { tab: 'history' as MobileTab, label: 'History', icon: '📜' },
              { tab: 'settings' as MobileTab, label: 'Menu', icon: '☰' },
            ] as const).map(({ tab, label, icon }) => (
              <button
                key={tab}
                onClick={() => setMobileTab(tab)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '3px', border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px 4px',
                  borderTop: mobileTab === tab ? '2px solid var(--orange-bright)' : '2px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: '20px', lineHeight: 1 }}>{icon}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '9px', color: mobileTab === tab ? 'var(--orange-bright)' : 'var(--text-muted)', letterSpacing: '0.06em' }}>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        {showSettings && wallet && (
          <SettingsModal wallet={wallet} currentDisplayName={displayName} socket={socket} onClose={() => setShowSettings(false)} onUsernameChanged={(name) => { setDisplayName(name); setShowSettings(false); }} />
        )}

        {showWinner && winnerInfo && (
          <WinnerOverlay winnerWallet={winnerInfo.winnerWallet} winnerDisplayName={winnerInfo.winnerDisplayName} winnerShare={winnerInfo.winnerShare} totalPot={winnerInfo.totalPot} isYou={winnerInfo.winnerWallet === wallet} roundId={winnerInfo.roundId} wallet={wallet} socket={socket} onClose={() => { setShowWinner(false); setWinnerInfo(null); }} />
        )}
      </>
    );
  }

  // ── DESKTOP LAYOUT ─────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>FruitBowl.fun — Solana Orangepot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {showUsernameModal && wallet && (
        <UsernameModal wallet={wallet} socket={socket} onConfirm={handleUsernameConfirm} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

        <header style={{ display: 'flex', alignItems: 'center', height: '58px', flexShrink: 0, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', padding: '0 20px', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ fontSize: '26px', lineHeight: 1 }}>🍓</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', color: '#e53e3e', letterSpacing: '-0.01em' }}>FruitBowl<span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>.fun</span></span>
          </div>

          <nav style={{ display: 'flex', alignItems: 'center', height: '100%', marginLeft: '8px' }}>
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '2px solid var(--orange-bright)', color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', letterSpacing: '0.01em' }}>🍊 Orangepot</div>
            <div onClick={() => router.push('/fruitroll')} style={{ height: '100%', display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '2px solid transparent', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', letterSpacing: '0.01em', transition: 'color 0.15s, border-color 0.15s' }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'rgba(72,187,120,0.6)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'transparent'; }}>🍉 FruitRoll</div>
            <div onClick={() => router.push('/referral')} style={{ height: '100%', display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '2px solid transparent', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', letterSpacing: '0.01em', transition: 'color 0.15s, border-color 0.15s' }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'rgba(167,139,250,0.6)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'transparent'; }}>🔗 Referrals</div>
          </nav>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#10b981' : '#ef4444', boxShadow: connected ? '0 0 8px #10b981' : 'none' }} />
          </div>

          {wallet && displayName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,140,0,0.08)', border: '1px solid rgba(255,140,0,0.2)', borderRadius: '8px', padding: '5px 12px', fontSize: '12px', color: 'var(--orange-soft)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,var(--orange-glow),var(--orange-soft))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#fff', fontWeight: 800 }}>{displayName.charAt(0).toUpperCase()}</div>
              {displayName}
            </div>
          )}

          {wallet && (
            <button onClick={() => setShowSettings(true)} title="Settings" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-muted)', cursor: 'pointer', width: '34px', height: '34px', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s' }}>⚙️</button>
          )}

          <WalletMultiButton />
        </header>

        {wallet && unclaimedTotal > 0 && (
          <div onClick={() => setShowSettings(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'linear-gradient(90deg, rgba(16,185,129,0.15), rgba(16,185,129,0.08), rgba(16,185,129,0.15))', borderBottom: '1px solid rgba(16,185,129,0.35)', padding: '9px 20px', cursor: 'pointer', flexShrink: 0 }}>
            <span style={{ fontSize: '16px' }}>💰</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: '#10b981', letterSpacing: '0.04em' }}>You have <strong>{(unclaimedTotal / 1_000_000_000).toFixed(4)} SOL</strong> in unclaimed winnings</span>
            <span style={{ fontSize: '11px', color: 'rgba(16,185,129,0.7)', fontFamily: 'var(--font-display)', fontWeight: 600, textDecoration: 'underline' }}>Claim in Settings →</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)', padding: '10px 20px', gap: '12px' }}>
          {statCards.map(({ label, value, icon, accent }) => (
            <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: accent ? 'linear-gradient(135deg, rgba(255,107,0,0.08), rgba(255,140,0,0.04))' : 'rgba(255,255,255,0.03)', border: accent ? '1px solid rgba(255,107,0,0.35)' : '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '14px 16px', boxShadow: accent ? '0 0 20px rgba(255,107,0,0.08)' : 'none' }}>
              <div style={{ fontSize: '20px', fontFamily: 'var(--font-display)', fontWeight: 700, color: accent ? 'var(--orange-bright)' : 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
                {icon && <span style={{ fontSize: '16px', opacity: 0.7 }}>{icon}</span>}
                {value}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.06em', marginTop: '5px', fontFamily: 'var(--font-display)', fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          <button onClick={() => setChatOpen(!chatOpen)} style={{ position: 'absolute', left: chatOpen ? '260px' : '0', top: '50%', transform: 'translateY(-50%)', zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderLeft: 'none', borderRadius: '0 8px 8px 0', padding: '14px 6px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '16px', transition: 'left 0.3s ease', display: 'flex', alignItems: 'center' }}>
            {chatOpen ? '‹' : '💬'}
          </button>

          <div style={{ width: chatOpen ? '260px' : '0', minWidth: chatOpen ? '260px' : '0', transition: 'all 0.3s ease', overflow: 'hidden', flexShrink: 0, borderRight: chatOpen ? '1px solid var(--border-color)' : 'none' }}>
            <Chat socket={socket} currentWallet={wallet} currentDisplayName={displayName} isConnected={connected} isMod={wallet === '9QeT88EePX6w7DsTWe5Tpx9s5go6QfxrUtpxtFeznfxi'} />
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden', minHeight: 0 }}>
            <div style={{ width: '100%', padding: '14px 24px 0', display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: '540px' }}>
                <BetPanel />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 24px 20px' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <div style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
                  <div style={{ width: 0, height: 0, borderLeft: '10px solid transparent', borderRight: '10px solid transparent', borderTop: '18px solid var(--orange-bright)', filter: 'drop-shadow(0 0 8px rgba(255,140,0,0.9))' }} />
                </div>
                {isSpinning && (
                  <div style={{ position: 'absolute', width: 404, height: 404, borderRadius: '50%', border: '3px solid transparent', borderTopColor: 'var(--orange-bright)', borderRightColor: 'var(--orange-soft)', animation: 'spin-jackpot 0.5s linear infinite', zIndex: 0 }} />
                )}
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <OrangeWheel players={round?.players || []} totalPot={round?.totalPot || 0} isSpinning={isSpinning} isIdleSpinning={isIdleSpinning} winnerWallet={round?.winnerWallet || null} size={360} avatarMap={avatarMap} />
                </div>
              </div>

              <div style={{ width: '100%', maxWidth: '540px', marginBottom: '12px' }}>
                <Countdown endsAt={round?.countdownEndsAt || null} status={round?.status || 'waiting'} />
              </div>

              <div style={{ width: '100%', maxWidth: '540px' }}>
                <PlayerList players={round?.players || []} totalPot={round?.totalPot || 0} winnerWallet={round?.winnerWallet || null} currentWallet={wallet} />
              </div>
            </div>
          </div>

          <div style={{ width: '240px', flexShrink: 0, borderLeft: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>ROUND</span>
              <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>#{roundDisplayId}</span>
            </div>
            <HistoryPanel />
          </div>
        </div>
      </div>

      {showSettings && wallet && (
        <SettingsModal wallet={wallet} currentDisplayName={displayName} socket={socket} onClose={() => setShowSettings(false)} onUsernameChanged={(name) => { setDisplayName(name); setShowSettings(false); }} />
      )}

      {showWinner && winnerInfo && (
        <WinnerOverlay winnerWallet={winnerInfo.winnerWallet} winnerDisplayName={winnerInfo.winnerDisplayName} winnerShare={winnerInfo.winnerShare} totalPot={winnerInfo.totalPot} isYou={winnerInfo.winnerWallet === wallet} roundId={winnerInfo.roundId} wallet={wallet} socket={socket} onClose={() => { setShowWinner(false); setWinnerInfo(null); }} />
      )}
    </>
  );
}

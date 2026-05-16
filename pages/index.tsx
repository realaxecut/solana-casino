import React, { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { io, Socket } from 'socket.io-client';
import OrangeWheel from '../components/OrangeWheel';
import Chat from '../components/Chat';
import PlayerList from '../components/PlayerList';
import BetPanel from '../components/BetPanel';
import AccountPanel from '../components/AccountPanel';
import Countdown from '../components/Countdown';
import WinnerOverlay from '../components/WinnerOverlay';

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

export default function Home() {
  const { publicKey } = useWallet();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [round, setRound] = useState<GameRound | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [winnerInfo, setWinnerInfo] = useState<WinnerInfo | null>(null);
  const [showWinner, setShowWinner] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

  const wallet = publicKey?.toBase58() || null;

  useEffect(() => {
    const s = io('https://casino.wsamcserver.xyz', { transports: ['websocket', 'polling'] });
    s.on('connect', () => { setConnected(true); s.emit('get_state'); });
    s.on('disconnect', () => setConnected(false));
    s.on('round_update', (r: GameRound) => { setRound(r); setIsSpinning(r.status === 'spinning'); });
    s.on('spin_started', () => { setIsSpinning(true); });
    s.on('winner_announced', (info: WinnerInfo) => { setWinnerInfo(info); setShowWinner(true); setIsSpinning(false); });
    s.on('new_round', () => { setIsSpinning(false); setWinnerInfo(null); });
    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  useEffect(() => {
    if (!wallet || !socket) return;
    socket.emit('register_user', {
      wallet,
      displayName: displayName || wallet.slice(0, 4) + '...' + wallet.slice(-4),
    });
  }, [wallet, socket]);

  const handleDisplayNameChange = useCallback((name: string) => {
    setDisplayName(name);
    if (wallet && socket) {
      socket.emit('register_user', { wallet, displayName: name });
    }
  }, [wallet, socket]);

  const myPlayer = round?.players.find(p => p.wallet === wallet);
  const myBet = myPlayer?.betAmount || 0;
  const myChance = myPlayer?.percentage || 0;
  const potSol = round ? (round.totalPot / 1_000_000_000).toFixed(4) : '0.0000';
  const myBetSol = (myBet / 1_000_000_000).toFixed(4);

  return (
    <>
      <Head>
        <title>Orange Jackpot - Solana Casino</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

        <header style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '0 24px', height: '56px', flexShrink: 0, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '22px' }}>🍊</span>
            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '16px', color: 'var(--orange-bright)', letterSpacing: '0.05em' }}>ORANGE JACKPOT</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em', paddingTop: '2px' }}>DEVNET</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#26DE81' : '#FC5C65', boxShadow: connected ? '0 0 6px #26DE81' : 'none' }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{connected ? 'LIVE' : 'CONNECTING'}</span>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <WalletMultiButton />
          </div>
        </header>

        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', flexShrink: 0, height: '48px' }}>
          {[
            { label: 'Jackpot Value', value: '◎ ' + potSol, highlight: true },
            { label: 'Your Wager', value: '◎ ' + myBetSol },
            { label: 'Your Chance', value: myChance > 0 ? myChance.toFixed(2) + '%' : '0.00%' },
            { label: 'Players', value: String(round?.players.length || 0) },
          ].map(({ label, value, highlight }, i) => (
            <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 16px', height: '100%', borderRight: i < 3 ? '1px solid var(--border-color)' : 'none', background: highlight ? 'rgba(255,107,0,0.05)' : 'transparent' }}>
              <div style={{ fontSize: '16px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: highlight ? 'var(--orange-bright)' : 'var(--text-primary)' }}>{value}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          <div style={{ width: chatOpen ? '240px' : '0', minWidth: chatOpen ? '240px' : '0', transition: 'all 0.3s ease', overflow: 'hidden', flexShrink: 0, borderRight: '1px solid var(--border-color)' }}>
            <Chat socket={socket} currentWallet={wallet} currentDisplayName={displayName} isConnected={connected} />
          </div>

          <button onClick={() => setChatOpen(!chatOpen)} style={{ position: 'absolute', left: chatOpen ? '240px' : '0', top: '50%', transform: 'translateY(-50%)', zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '0 6px 6px 0', padding: '10px 5px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', transition: 'left 0.3s' }}>
            {chatOpen ? '<' : 'C'}
          </button>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', gap: '16px', overflow: 'auto' }}>
            <div style={{ width: '100%', maxWidth: '460px' }}>
              <Countdown endsAt={round?.countdownEndsAt || null} status={round?.status || 'waiting'} />
            </div>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: 0, height: 0, borderLeft: '10px solid transparent', borderRight: '10px solid transparent', borderTop: '18px solid var(--orange-bright)', filter: 'drop-shadow(0 0 6px rgba(255,140,0,0.8))' }} />
              </div>
              {isSpinning && (
                <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', border: '3px solid transparent', borderTopColor: '#FF6B00', borderRightColor: '#FF9F1C', animation: 'spin-jackpot 0.6s linear infinite', zIndex: 0 }} />
              )}
              <div style={{ position: 'relative', zIndex: 1 }}>
                <OrangeWheel players={round?.players || []} totalPot={round?.totalPot || 0} isSpinning={isSpinning} winnerWallet={round?.winnerWallet || null} size={360} />
              </div>
            </div>

            <div style={{ width: '100%', maxWidth: '520px' }}>
              <PlayerList players={round?.players || []} totalPot={round?.totalPot || 0} winnerWallet={round?.winnerWallet || null} currentWallet={wallet} />
            </div>
          </div>

          <div style={{ width: '320px', flexShrink: 0, borderLeft: '1px solid var(--border-color)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', background: 'var(--bg-secondary)' }}>
            <AccountPanel displayName={displayName} onDisplayNameChange={handleDisplayNameChange} />
            <BetPanel socket={socket} displayName={displayName} roundStatus={round?.status || 'waiting'} myBet={myBet} isConnected={connected} />
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '10px' }}>HOW IT WORKS</div>
              {[
                ['🍊', 'Buy a slice with SOL - bigger bet = bigger slice'],
                ['⏳', 'Wheel spins after 60s countdown'],
                ['🎰', 'Spin is weighted by your % of the pot'],
                ['💰', 'Winner takes 95% of the total pot'],
              ].map(([icon, text]) => (
                <div key={text as string} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '13px', flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{text}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 'auto', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
              Orange Jackpot · Solana Devnet · 5% House Edge
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

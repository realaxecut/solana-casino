import React, { useEffect, useState, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { io, Socket } from 'socket.io-client';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import Chat from '../components/Chat';
import SettingsModal from '../components/SettingsModal';

interface ReferralStats {
  totalReferrals: number;
  totalEarned: number;
  referrals: Array<{
    referred_wallet: string;
    display_name: string | null;
    created_at: number;
  }>;
}

interface ReferralEarning {
  id: string;
  referred_wallet: string;
  referred_name: string | null;
  round_id: string;
  earning_type: 'win' | 'loss';
  source_amount: number;
  bonus_amount: number;
  claimed: number;
  claim_tx: string | null;
  created_at: number;
  claimed_at: number | null;
}

export default function ReferralPage() {
  const { publicKey } = useWallet();
  const router = useRouter();
  const wallet = publicKey?.toBase58() || null;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [chatOpen, setChatOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [pendingEarnings, setPendingEarnings] = useState<ReferralEarning[]>([]);
  const [claimedEarnings, setClaimedEarnings] = useState<ReferralEarning[]>([]);
  const [totalUnclaimed, setTotalUnclaimed] = useState(0);
  const [totalClaimed, setTotalClaimed] = useState(0);
  const [payoutsPaused, setPayoutsPaused] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{ success: boolean; tx?: string; error?: string; amount?: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [refParam, setRefParam] = useState<string | null>(null);
  const [referralRegistered, setReferralRegistered] = useState(false);
  const [liveBonus, setLiveBonus] = useState<{ amount: number } | null>(null);

  // Slug state
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const [slugInput, setSlugInput] = useState('');
  const [slugLoading, setSlugLoading] = useState(false);
  const [slugError, setSlugError] = useState('');
  const [slugSuccess, setSlugSuccess] = useState('');

  // Extract ?ref= param on load
  useEffect(() => {
    if (router.query.ref && typeof router.query.ref === 'string') {
      setRefParam(router.query.ref);
    }
  }, [router.query.ref]);

  // Load display name from localStorage
  useEffect(() => {
    if (wallet) {
      const stored = localStorage.getItem(`username_${wallet}`);
      if (stored) setDisplayName(stored);
    }
  }, [wallet]);

  // Connect socket
  useEffect(() => {
    const s = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'https://fruitbowl.fun', {
      transports: ['websocket', 'polling'],
    });
    s.on('connect', () => { setConnected(true); s.emit('get_state'); });
    s.on('disconnect', () => setConnected(false));
    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  // When wallet connects, fetch stats + slug, register referral if needed
  useEffect(() => {
    if (!socket || !wallet) return;

    socket.emit('register_user', { wallet, displayName: displayName || wallet.slice(0, 8) });
    socket.emit('get_referral_stats', { wallet });
    socket.emit('get_pending_referral_earnings', { wallet });
    socket.emit('get_referral_slug', { wallet });

    if (refParam && refParam !== wallet) {
      socket.emit('register_referral', { referredWallet: wallet, referrerWallet: refParam });
    }

    const onStats = (data: ReferralStats) => setStats(data);
    const onPendingEarnings = (data: { pending: ReferralEarning[]; claimed: ReferralEarning[]; totalUnclaimed: number; totalClaimed: number; paused: boolean }) => {
      setPendingEarnings(data.pending);
      setClaimedEarnings(data.claimed);
      setTotalUnclaimed(data.totalUnclaimed);
      setTotalClaimed(data.totalClaimed);
      setPayoutsPaused(data.paused);
    };
    const onRegistered = (result: { success: boolean }) => { if (result.success) setReferralRegistered(true); };
    const onSlug = ({ slug }: { slug: string | null }) => {
      setCurrentSlug(slug);
      if (slug) setSlugInput(slug);
    };
    const onSlugResult = (result: { success: boolean; slug?: string; error?: string }) => {
      setSlugLoading(false);
      if (result.success && result.slug) {
        setCurrentSlug(result.slug);
        setSlugInput(result.slug);
        setSlugSuccess('Link updated!');
        setSlugError('');
        setTimeout(() => setSlugSuccess(''), 3000);
      } else {
        setSlugError(result.error || 'Failed to update');
        setSlugSuccess('');
      }
    };
    const onBonus = ({ referrerWallet, bonusAmount }: any) => {
      if (referrerWallet === wallet) {
        setLiveBonus({ amount: bonusAmount });
        socket.emit('get_referral_stats', { wallet });
        socket.emit('get_pending_referral_earnings', { wallet });
        setTimeout(() => setLiveBonus(null), 6000);
      }
    };
    const onBonusQueued = ({ referrerWallet, bonusAmount }: any) => {
      if (referrerWallet === wallet) {
        setLiveBonus({ amount: bonusAmount });
        socket.emit('get_pending_referral_earnings', { wallet });
        setTimeout(() => setLiveBonus(null), 6000);
      }
    };
    const onClaimResult = (result: { success: boolean; claimTx?: string; amount?: number; error?: string }) => {
      setClaiming(false);
      if (result.success) {
        setClaimResult({ success: true, tx: result.claimTx, amount: result.amount });
        socket.emit('get_pending_referral_earnings', { wallet });
        socket.emit('get_referral_stats', { wallet });
      } else {
        setClaimResult({ success: false, error: result.error });
      }
      setTimeout(() => setClaimResult(null), 8000);
    };
    const onPayoutsPaused = ({ paused }: { paused: boolean }) => setPayoutsPaused(paused);

    socket.on('referral_stats', onStats);
    socket.on('pending_referral_earnings', onPendingEarnings);
    socket.on('referral_registered', onRegistered);
    socket.on('referral_slug', onSlug);
    socket.on('referral_slug_result', onSlugResult);
    socket.on('referral_bonus', onBonus);
    socket.on('referral_bonus_queued', onBonusQueued);
    socket.on('referral_claim_result', onClaimResult);
    socket.on('referral_payouts_paused', onPayoutsPaused);

    return () => {
      socket.off('referral_stats', onStats);
      socket.off('pending_referral_earnings', onPendingEarnings);
      socket.off('referral_registered', onRegistered);
      socket.off('referral_slug', onSlug);
      socket.off('referral_slug_result', onSlugResult);
      socket.off('referral_bonus', onBonus);
      socket.off('referral_bonus_queued', onBonusQueued);
      socket.off('referral_claim_result', onClaimResult);
      socket.off('referral_payouts_paused', onPayoutsPaused);
    };
  }, [socket, wallet, refParam, displayName]);

  // Generate a short code from wallet (first 6 chars + last 4)
  const autoSlug = wallet ? wallet.slice(0, 4).toLowerCase() + wallet.slice(-4).toLowerCase() : '';
  const activeCode = currentSlug || autoSlug;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const referralLink = wallet ? `${origin}/?ref=${activeCode}` : '';

  const handleCopy = useCallback(() => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [referralLink]);

  const handleClaimEarnings = useCallback(() => {
    if (!socket || !wallet || claiming || totalUnclaimed === 0 || payoutsPaused) return;
    setClaiming(true);
    setClaimResult(null);
    socket.emit('claim_referral_earnings', { wallet });
  }, [socket, wallet, claiming, totalUnclaimed, payoutsPaused]);

  const handleSaveSlug = () => {
    if (!socket || !wallet) return;
    const trimmed = slugInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!trimmed || trimmed.length < 3) { setSlugError('Must be at least 3 characters (a-z, 0-9, _ -)'); return; }
    if (trimmed.length > 20) { setSlugError('Max 20 characters'); return; }
    setSlugLoading(true);
    setSlugError('');
    socket.emit('set_referral_slug', { wallet, slug: trimmed });
  };

  const formatSol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);
  const shortenWallet = (w: string) => `${w.slice(0, 4)}...${w.slice(-4)}`;
  const formatDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const isMod = wallet === '9QeT88EePX6w7DsTWe5Tpx9s5go6QfxrUtpxtFeznfxi';

  return (
    <>
      <Head>
        <title>Referrals — FruitBowl.fun</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

        {/* ── HEADER (identical to index.tsx) ── */}
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
            <span style={{
              fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px',
              color: '#e53e3e', letterSpacing: '-0.01em',
            }}>FruitBowl<span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>.fun</span></span>
          </div>

          <nav style={{ display: 'flex', alignItems: 'center', height: '100%', marginLeft: '8px' }}>
            {/* Orangepot */}
            <div
              onClick={() => router.push('/')}
              style={{
                height: '100%', display: 'flex', alignItems: 'center',
                padding: '0 16px',
                borderBottom: '2px solid transparent',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px',
                cursor: 'pointer', letterSpacing: '0.01em', transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'rgba(255,140,0,0.6)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'transparent'; }}
            >🍊 Orangepot</div>

            {/* FruitRoll */}
            <div
              onClick={() => router.push('/fruitroll')}
              style={{
                height: '100%', display: 'flex', alignItems: 'center',
                padding: '0 16px',
                borderBottom: '2px solid transparent',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px',
                cursor: 'pointer', letterSpacing: '0.01em', transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'rgba(72,187,120,0.6)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'transparent'; }}
            >🍉 FruitRoll</div>

            {/* Referrals — active */}
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center',
              padding: '0 16px',
              borderBottom: '2px solid var(--orange-bright)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px',
              cursor: 'pointer', letterSpacing: '0.01em',
            }}>🔗 Referrals</div>
          </nav>

          <div style={{ flex: 1 }} />

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

        {/* ── STAT BAR ── */}
        <div style={{
          display: 'flex', alignItems: 'center', flexShrink: 0,
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border-color)',
          padding: '10px 20px', gap: '12px',
        }}>
          {[
            { label: 'Your Referrals', value: stats?.totalReferrals ?? '—', icon: '👥', accent: false },
            { label: 'Unclaimed', value: totalUnclaimed > 0 ? `◎ ${formatSol(totalUnclaimed)}` : '—', icon: null, accent: totalUnclaimed > 0 },
            { label: 'Total Claimed', value: totalClaimed > 0 ? `◎ ${formatSol(totalClaimed)}` : '—', icon: '◎', accent: false },
            { label: 'Your Link', value: activeCode ? `/?ref=${activeCode}` : 'Not set', icon: null, accent: false },
          ].map(({ label, value, icon, accent }) => (
            <div key={label} style={{
              flex: 1,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              background: accent
                ? 'linear-gradient(135deg, rgba(255,107,0,0.08), rgba(255,140,0,0.04))'
                : 'rgba(255,255,255,0.03)',
              border: accent
                ? '1px solid rgba(255,107,0,0.35)'
                : '1px solid rgba(255,255,255,0.07)',
              borderRadius: '14px', padding: '14px 16px',
              boxShadow: accent ? '0 0 20px rgba(255,107,0,0.08)' : 'none',
            }}>
              <div style={{
                fontSize: '18px', fontFamily: 'var(--font-display)', fontWeight: 700,
                color: accent ? 'var(--orange-bright)' : 'var(--text-primary)',
                letterSpacing: '-0.01em', lineHeight: 1,
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                {icon && <span style={{ fontSize: '14px', opacity: 0.7 }}>{icon}</span>}
                {value}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.06em', marginTop: '5px', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* ── MAIN BODY ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

          {/* Chat toggle */}
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
          >{chatOpen ? '‹' : '💬'}</button>

          {/* Chat panel */}
          <div style={{
            width: chatOpen ? '260px' : '0', minWidth: chatOpen ? '260px' : '0',
            transition: 'all 0.3s ease', overflow: 'hidden', flexShrink: 0,
            borderRight: chatOpen ? '1px solid var(--border-color)' : 'none',
          }}>
            <Chat socket={socket} currentWallet={wallet} currentDisplayName={displayName} isConnected={connected} isMod={isMod} />
          </div>

          {/* ── CONTENT ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>

            {/* Live bonus toast */}
            {liveBonus && (
              <div style={{
                background: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.4)',
                borderRadius: '12px', padding: '14px 20px',
                marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px',
              }}>
                <span style={{ fontSize: '24px' }}>🎉</span>
                <div>
                  <div style={{ fontWeight: 700, color: '#10b981', fontSize: '14px' }}>Referral bonus received!</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>+{formatSol(liveBonus.amount)} SOL just hit your wallet</div>
                </div>
              </div>
            )}

            {referralRegistered && (
              <div style={{
                background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: '12px', padding: '12px 18px', marginBottom: '20px',
                fontSize: '13px', color: '#a78bfa',
              }}>
                ✅ Referral link applied — your referrer earns 30% of your future winnings.
              </div>
            )}

            {!wallet ? (
              <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                borderRadius: '16px', padding: '60px 32px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔗</div>
                <p style={{ color: 'var(--text-muted)', marginBottom: '24px', lineHeight: 1.7, fontSize: '14px' }}>
                  Connect your wallet to get your referral link<br />and track your earnings
                </p>
                <WalletMultiButton />
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>

                {/* LEFT COLUMN */}
                <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

                  {/* How it works */}
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                    borderRadius: '14px', padding: '18px 20px',
                  }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '14px' }}>HOW IT WORKS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {[
                        { icon: '🔗', title: 'Share your link', desc: 'Send your unique referral link to anyone' },
                        { icon: '🎰', title: 'They play', desc: 'Your referred friend joins games on FruitBowl' },
                        { icon: '💸', title: 'You earn', desc: '30% of house tax when they win + 30% of their bet when they lose — claim any time' },
                      ].map(step => (
                        <div key={step.title} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: '20px', flexShrink: 0 }}>{step.icon}</span>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '2px' }}>{step.title}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{step.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    {[
                      { label: 'REFERRED PLAYERS', value: stats?.totalReferrals ?? '—', color: 'var(--text-primary)' },
                      { label: 'TOTAL CLAIMED', value: totalClaimed > 0 ? `◎ ${formatSol(totalClaimed)}` : '—', color: '#10b981' },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                        borderRadius: '14px', padding: '16px 18px', position: 'relative', overflow: 'hidden',
                      }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg,#9f67fa,#22d3ee)' }} />
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
                        <div style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--font-display)', color }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Referred players list */}
                  {stats && stats.referrals.length > 0 && (
                    <div style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                      borderRadius: '14px', padding: '18px 20px',
                    }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '12px' }}>
                        YOUR REFERRALS ({stats.totalReferrals})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {stats.referrals.map(r => (
                          <div key={r.referred_wallet} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px',
                          }}>
                            <div style={{ fontSize: '13px' }}>{r.display_name || shortenWallet(r.referred_wallet)}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatDate(r.created_at)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT COLUMN */}
                <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

                  {/* Your link + copy */}
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                    borderRadius: '14px', padding: '18px 20px', position: 'relative', overflow: 'hidden',
                  }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg,#9f67fa,#22d3ee)' }} />
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '12px' }}>YOUR REFERRAL LINK</div>

                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                      <div style={{
                        flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)',
                        borderRadius: '8px', padding: '10px 14px', fontSize: '12px',
                        color: 'var(--text-secondary)', fontFamily: 'Space Mono, monospace',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{referralLink}</div>
                      <button
                        onClick={handleCopy}
                        className="btn-primary"
                        style={{ padding: '10px 18px', fontSize: '12px', flexShrink: 0, minWidth: '80px' }}
                      >{copied ? '✓ Copied!' : 'Copy'}</button>
                    </div>

                    {/* Custom slug editor */}
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.06em' }}>
                        CUSTOMIZE LINK ENDING
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '8px' }}>
                        <div style={{
                          background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)',
                          borderRight: 'none', borderRadius: '8px 0 0 8px',
                          padding: '9px 12px', fontSize: '11px', color: 'var(--text-muted)',
                          fontFamily: 'Space Mono, monospace', whiteSpace: 'nowrap', flexShrink: 0,
                        }}>?ref=</div>
                        <input
                          value={slugInput}
                          onChange={e => { setSlugInput(e.target.value); setSlugError(''); setSlugSuccess(''); }}
                          placeholder={autoSlug}
                          maxLength={20}
                          style={{
                            flex: 1, fontSize: '13px', padding: '9px 12px',
                            fontFamily: 'Space Mono, monospace', fontWeight: 700,
                            borderRadius: '0', borderLeft: 'none', borderRight: 'none',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid var(--border-color)',
                          }}
                        />
                        <button
                          onClick={handleSaveSlug}
                          disabled={slugLoading || !slugInput.trim()}
                          className="btn-primary"
                          style={{
                            padding: '9px 16px', fontSize: '12px',
                            borderRadius: '0 8px 8px 0', flexShrink: 0,
                            opacity: slugLoading ? 0.6 : 1,
                          }}
                        >{slugLoading ? '...' : 'Save'}</button>
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Letters, numbers, _ and - only · 3–20 chars
                      </div>
                      {slugError && <div style={{ marginTop: '6px', fontSize: '11px', color: '#f87171' }}>⚠ {slugError}</div>}
                      {slugSuccess && <div style={{ marginTop: '6px', fontSize: '11px', color: '#10b981' }}>✓ {slugSuccess}</div>}
                    </div>
                  </div>

                  {/* Claimable Earnings Panel */}
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                    borderRadius: '14px', padding: '18px 20px', flex: 1,
                  }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                        CLAIMABLE EARNINGS
                      </div>
                      {totalUnclaimed > 0 && (
                        <div style={{ fontSize: '13px', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-display)' }}>
                          ◎{formatSol(totalUnclaimed)} ready
                        </div>
                      )}
                    </div>

                    {/* Paused banner */}
                    {payoutsPaused && (
                      <div style={{
                        background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.35)',
                        borderRadius: '10px', padding: '10px 14px', marginBottom: '14px',
                        fontSize: '12px', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '8px',
                      }}>
                        <span style={{ fontSize: '16px' }}>⏸</span>
                        <div>
                          <div style={{ fontWeight: 700 }}>Payouts temporarily paused</div>
                          <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>The moderator has paused referral payouts. Your earnings are safe — try again soon.</div>
                        </div>
                      </div>
                    )}

                    {/* Claim result */}
                    {claimResult && (
                      <div style={{
                        background: claimResult.success ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                        border: `1px solid ${claimResult.success ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
                        borderRadius: '10px', padding: '10px 14px', marginBottom: '14px',
                        fontSize: '12px', color: claimResult.success ? '#10b981' : '#f87171',
                      }}>
                        {claimResult.success ? (
                          <>
                            <div style={{ fontWeight: 700 }}>✓ Claimed ◎{formatSol(claimResult.amount || 0)}!</div>
                            {claimResult.tx && (
                              <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.8, fontFamily: 'Space Mono, monospace' }}>
                                tx: {claimResult.tx.slice(0, 20)}…
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ fontWeight: 600 }}>⚠ {claimResult.error}</div>
                        )}
                      </div>
                    )}

                    {/* Pending list */}
                    {pendingEarnings.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '20px 0 8px', lineHeight: 1.7 }}>
                        No unclaimed earnings yet.<br />
                        <span style={{ fontSize: '11px' }}>Share your link — earn when they win or lose.</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', maxHeight: '200px', overflowY: 'auto' }}>
                        {pendingEarnings.map(e => (
                          <div key={e.id} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '8px 12px', background: 'rgba(16,185,129,0.05)',
                            borderRadius: '8px', border: '1px solid rgba(16,185,129,0.15)',
                          }}>
                            <div>
                              <div style={{ fontSize: '12px', fontWeight: 600 }}>
                                {e.referred_name || shortenWallet(e.referred_wallet)}&nbsp;
                                <span style={{ color: e.earning_type === 'win' ? '#fbbf24' : '#f87171', fontSize: '10px' }}>
                                  {e.earning_type === 'win' ? '🏆 won' : '💔 lost'}
                                </span>
                              </div>
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                {formatDate(e.created_at)} · {e.earning_type === 'win' ? `30% of 5% tax on ◎${formatSol(e.source_amount)}` : `30% of ◎${formatSol(e.source_amount)} bet`}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: '13px', fontWeight: 700, color: '#10b981' }}>
                                +◎{formatSol(e.bonus_amount)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Claim button */}
                    <button
                      onClick={handleClaimEarnings}
                      disabled={claiming || totalUnclaimed === 0 || payoutsPaused}
                      style={{
                        width: '100%', padding: '13px', borderRadius: '10px', border: 'none',
                        cursor: (claiming || totalUnclaimed === 0 || payoutsPaused) ? 'not-allowed' : 'pointer',
                        background: (claiming || totalUnclaimed === 0 || payoutsPaused)
                          ? 'rgba(255,255,255,0.05)'
                          : 'linear-gradient(135deg, #10b981, #059669)',
                        color: (claiming || totalUnclaimed === 0 || payoutsPaused) ? 'var(--text-muted)' : '#fff',
                        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '14px',
                        letterSpacing: '0.02em',
                        boxShadow: (claiming || totalUnclaimed === 0 || payoutsPaused) ? 'none' : '0 0 20px rgba(16,185,129,0.3)',
                        transition: 'all 0.2s',
                      }}
                    >
                      {claiming ? '⏳ Sending...' : payoutsPaused ? '⏸ Payouts Paused' : totalUnclaimed === 0 ? 'Nothing to Claim' : `🎉 Claim ◎${formatSol(totalUnclaimed)}`}
                    </button>

                    {/* Claimed history */}
                    {claimedEarnings.length > 0 && (
                      <div style={{ marginTop: '18px' }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '8px' }}>
                          CLAIM HISTORY
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '160px', overflowY: 'auto' }}>
                          {claimedEarnings.map(e => (
                            <div key={e.id} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '7px 10px', background: 'rgba(255,255,255,0.02)',
                              borderRadius: '7px', border: '1px solid var(--border-color)',
                              opacity: 0.7,
                            }}>
                              <div>
                                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                  {e.referred_name || shortenWallet(e.referred_wallet)}&nbsp;
                                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                                    {e.earning_type === 'win' ? 'won' : 'lost'}
                                  </span>
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{formatDate(e.claimed_at || e.created_at)}</div>
                              </div>
                              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>
                                ◎{formatSol(e.bonus_amount)} ✓
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
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

import React, { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';

interface SettingsModalProps {
  wallet: string;
  currentDisplayName: string;
  socket: Socket | null;
  onClose: () => void;
  onUsernameChanged: (newName: string) => void;
}

export default function SettingsModal({ wallet, currentDisplayName, socket, onClose, onUsernameChanged }: SettingsModalProps) {
  const [newName, setNewName] = useState(currentDisplayName);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState('');
  const [levelInfo, setLevelInfo] = useState<any>(null);
  const [referredBy, setReferredBy] = useState<string | null>(() => localStorage.getItem(`referredBy_${wallet}`));
  const [refInput, setRefInput] = useState('');
  const [refSaving, setRefSaving] = useState(false);
  const [refMsg, setRefMsg] = useState('');
  const [clearChatConfirm, setClearChatConfirm] = useState(false);
  const [clearChatMsg, setClearChatMsg] = useState('');
  const [closeGameConfirm, setCloseGameConfirm] = useState(false);
  const [closeGameMsg, setCloseGameMsg] = useState('');
  const [lockedGames, setLockedGames] = useState<string[]>([]);
  const [referralPayoutsPaused, setReferralPayoutsPaused] = useState(false);
  const [referralPauseMsg, setReferralPauseMsg] = useState('');
  const [fruitRollAlwaysLose, setFruitRollAlwaysLose] = useState<boolean>(() => {
    try { return localStorage.getItem('mod_fruitroll_always_lose') === 'true'; } catch { return false; }
  });
  const [unclaimedWins, setUnclaimedWins] = useState<{id: string; game_type: string; amount: number; created_at: number; fruit_count?: number}[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimResults, setClaimResults] = useState<Record<string, {tx?: string; error?: string; success?: boolean}>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onCheckResult = (res: { available: boolean; error: string | null }) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setChecking(false);
      setAvailable(res.available);
      if (!res.available && res.error) setError(res.error);
      else setError('');
    };
    socket.on('username_check_result', onCheckResult);
    return () => { socket.off('username_check_result', onCheckResult); };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const onChangeResult = (res: { success: boolean; error?: string; user?: { displayName: string } }) => {
      setSaving(false);
      if (res.success && res.user) {
        setSuccess('Username updated!');
        setAvailable(null);
        onUsernameChanged(res.user.displayName);
        localStorage.setItem(`username_${wallet}`, res.user.displayName);
      } else {
        setError(res.error || 'Failed to update username');
      }
    };
    socket.on('username_change_result', onChangeResult);
    return () => { socket.off('username_change_result', onChangeResult); };
  }, [socket, wallet, onUsernameChanged]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const trimmed = newName.trim();
    setSuccess('');
    if (!trimmed || trimmed === currentDisplayName || trimmed.length < 2) {
      setAvailable(null); setChecking(false); return;
    }
    if (!socket || !socket.connected) {
      setAvailable(true); setChecking(false); return;
    }
    setChecking(true); setAvailable(null);
    timeoutRef.current = setTimeout(() => { setChecking(false); setAvailable(true); }, 3000);
    debounceRef.current = setTimeout(() => {
      if (!socket || !socket.connected) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setChecking(false); setAvailable(true); return;
      }
      socket.emit('check_username', { name: trimmed, wallet });
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [newName, socket, wallet, currentDisplayName]);

  const handleSave = () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed.length < 2) { setError('Username must be at least 2 characters'); return; }
    if (trimmed === currentDisplayName) { setError('That is already your username'); return; }
    if (available === false) { setError('Username already taken'); return; }
    if (!socket) { setError('Not connected to server'); return; }
    setSaving(true);
    setError('');
    socket.emit('change_username', { wallet, newName: trimmed });
  };

  useEffect(() => {
    if (!socket) return;
    const onResult = (res: { success: boolean; error?: string }) => {
      setAvatarSaving(false);
      setAvatarMsg(res.success ? '✓ Avatar saved!' : res.error || 'Failed');
      setTimeout(() => setAvatarMsg(''), 3000);
    };
    const onProfile = (user: any) => { if (user.level) setLevelInfo(user.level); };
    socket.on('profile_data', onProfile);
    socket.emit('get_profile', { wallet });
    socket.on('avatar_result', onResult);

    // Load unclaimed wins
    socket.emit('get_unclaimed_wins', { wallet });
    const onUnclaimed = (data: { items: any[]; totalLamports: number }) => {
      setUnclaimedWins(data.items || []);
    };
    socket.on('unclaimed_wins', onUnclaimed);

    // Listen for orangepot claim result (from settings)
    const onClaimResult = (res: { success: boolean; claimTx?: string; error?: string; alreadyClaimed?: boolean }) => {
      setClaimingId(null);
      if (res.success || res.alreadyClaimed) {
        // Remove from list
        setUnclaimedWins(prev => prev.filter(w => !w.id.startsWith('settings_claiming_')));
        socket.emit('get_unclaimed_wins', { wallet }); // refresh
      }
    };
    socket.on('claim_result', onClaimResult);

    // Listen for fruitroll claim result (from settings)
    const onFruitrollClaimResult = (res: { success: boolean; claimTx?: string; error?: string; alreadyClaimed?: boolean }) => {
      setClaimingId(prev => {
        if (!prev) return null;
        setClaimResults(prevResults => ({
          ...prevResults,
          [prev]: { success: res.success, tx: res.claimTx, error: res.error },
        }));
        return null;
      });
      if (res.success) {
        setTimeout(() => socket.emit('get_unclaimed_wins', { wallet }), 500);
      }
    };
    socket.on('fruitroll_claim_result', onFruitrollClaimResult);

    return () => {
      socket.off('avatar_result', onResult);
      socket.off('profile_data', onProfile);
      socket.off('unclaimed_wins', onUnclaimed);
      socket.off('claim_result', onClaimResult);
      socket.off('fruitroll_claim_result', onFruitrollClaimResult);
    };
  }, [socket, wallet]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) { setAvatarMsg('Image must be under 2MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatar(dataUrl);
      setAvatarSaving(true);
      setAvatarMsg('');
      socket?.emit('set_avatar', { wallet, avatarDataUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const handleClearChat = () => {
    if (!clearChatConfirm) { setClearChatConfirm(true); return; }
    if (!socket) { setClearChatMsg('Not connected'); return; }
    socket.emit('mod_clear_chat', { wallet });
    setClearChatConfirm(false);
    setClearChatMsg('✓ Chat cleared');
    setTimeout(() => setClearChatMsg(''), 3000);
  };

  const handleCloseGame = () => {
    if (!closeGameConfirm) { setCloseGameConfirm(true); return; }
    if (!socket) { setCloseGameMsg('Not connected'); return; }
    socket.emit('mod_close_game', { wallet });
    setCloseGameConfirm(false);
    setCloseGameMsg('✓ Round closed');
    setTimeout(() => setCloseGameMsg(''), 3000);
  };

  const toggleGameLock = (gameType: string) => {
    if (!socket) return;
    const isLocked = lockedGames.includes(gameType);
    if (isLocked) {
      socket.emit('mod_unlock_game', { wallet, gameType });
    } else {
      socket.emit('mod_lock_game', { wallet, gameType });
    }
  };

  // Sync locked games state from server
  useEffect(() => {
    if (!socket) return;
    const onLockedGames = (games: string[]) => setLockedGames(games);
    socket.on('locked_games', onLockedGames);
    socket.emit('get_state');
    return () => { socket.off('locked_games', onLockedGames); };
  }, [socket]);

  // Sync referral pause state (mod only)
  useEffect(() => {
    if (!socket || wallet !== '9QeT88EePX6w7DsTWe5Tpx9s5go6QfxrUtpxtFeznfxi') return;
    const onPauseResult = ({ paused }: { success: boolean; paused: boolean }) => {
      setReferralPayoutsPaused(paused);
    };
    const onPayoutsPaused = ({ paused }: { paused: boolean }) => setReferralPayoutsPaused(paused);
    socket.on('mod_referral_pause_result', onPauseResult);
    socket.on('referral_payouts_paused', onPayoutsPaused);
    socket.emit('mod_get_referral_pause', { wallet });
    return () => {
      socket.off('mod_referral_pause_result', onPauseResult);
      socket.off('referral_payouts_paused', onPayoutsPaused);
    };
  }, [socket, wallet]);

  const toggleReferralPayoutsPause = () => {
    if (!socket) return;
    socket.emit('mod_toggle_referral_pause', { wallet });
    const next = !referralPayoutsPaused;
    setReferralPauseMsg(next ? '⏸ Referral payouts paused' : '▶ Referral payouts resumed');
    setTimeout(() => setReferralPauseMsg(''), 3000);
  };

  const toggleFruitRollAlwaysLose = () => {
    const next = !fruitRollAlwaysLose;
    setFruitRollAlwaysLose(next);
    try { localStorage.setItem('mod_fruitroll_always_lose', String(next)); } catch {}
  };

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSave(); };
  const shortWallet = wallet.slice(0, 6) + '...' + wallet.slice(-6);
  const trimmed = newName.trim();
  const isChanged = trimmed !== currentDisplayName && trimmed.length >= 2;
  const canSave = isChanged && available !== false && !checking && !saving;
  const borderColor = error ? 'rgba(252,92,101,0.5)' : (available === true || success) ? 'rgba(16,185,129,0.6)' : 'rgba(255,107,0,0.3)';

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000, backdropFilter: 'blur(8px)',
        opacity: visible ? 1 : 0, transition: 'opacity 0.2s ease',
      }}
    >
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)', borderRadius: '20px',
        width: '100%', maxWidth: '460px', margin: '0 20px',
        transform: visible ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(10px)',
        transition: 'transform 0.22s ease', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', borderBottom: '1px solid var(--border-color)',
          background: 'rgba(255,107,0,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>⚙️</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '16px', color: 'var(--text-primary)' }}>Settings</span>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)',
            borderRadius: '8px', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '18px', width: '32px', height: '32px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px', overflowY: 'auto', maxHeight: 'calc(90vh - 120px)' }}>

          {/* Wallet info */}
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)',
            borderRadius: '12px', padding: '14px 16px', marginBottom: '24px',
          }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '6px', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              CONNECTED WALLET
            </div>
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: '13px', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
              {shortWallet}
            </div>
          </div>

          {/* ── Unclaimed Winnings ── */}
          {unclaimedWins.length > 0 && (
            <div style={{
              background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: '12px', padding: '14px 16px', marginBottom: '24px',
            }}>
              <div style={{ fontSize: '10px', color: '#10b981', letterSpacing: '0.08em', marginBottom: '12px', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                💰 UNCLAIMED WINNINGS
              </div>
              {unclaimedWins.map((win) => {
                const solAmount = (win.amount / 1_000_000_000).toFixed(4);
                const isClaimingThis = claimingId === win.id;
                const result = claimResults[win.id];
                return (
                  <div key={win.id} style={{
                    background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)',
                    borderRadius: '10px', padding: '12px', marginBottom: '8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', color: '#10b981' }}>
                        +{solAmount} ◎
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {win.game_type === 'fruitroll' ? '🍉 FruitRoll' : '🍊 Orangepot'}
                        {' · '}
                        {new Date(win.created_at).toLocaleDateString()}
                      </div>
                      {result?.error && (
                        <div style={{ fontSize: '10px', color: '#f87171', marginTop: '4px' }}>{result.error}</div>
                      )}
                      {result?.tx && (
                        <a href={`https://explorer.solana.com/tx/${result.tx}`} target="_blank" rel="noreferrer"
                          style={{ fontSize: '10px', color: '#10b981', textDecoration: 'underline' }}>
                          View tx ↗
                        </a>
                      )}
                    </div>
                    {!result?.tx && (
                      <button
                        onClick={() => {
                          if (isClaimingThis || !socket) return;
                          setClaimingId(win.id);
                          if (win.game_type === 'fruitroll') {
                            socket.emit('claim_fruitroll_payout', { wallet, claimId: win.id });
                          } else {
                            socket.emit('claim_payout', { wallet, roundId: win.id });
                          }
                        }}
                        disabled={isClaimingThis || !!claimingId}
                        style={{
                          padding: '8px 14px', borderRadius: '8px', border: 'none', cursor: (isClaimingThis || !!claimingId) ? 'not-allowed' : 'pointer',
                          background: isClaimingThis ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg,#10b981,#059669)',
                          color: isClaimingThis ? 'var(--text-muted)' : '#fff',
                          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px',
                          flexShrink: 0, transition: 'all 0.2s',
                          boxShadow: isClaimingThis ? 'none' : '0 0 12px rgba(16,185,129,0.3)',
                        }}
                      >
                        {isClaimingThis ? '⏳' : '💰 Claim'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Referral code */}
          <div style={{
            background: 'rgba(255,107,0,0.04)', border: '1px solid rgba(255,107,0,0.15)',
            borderRadius: '12px', padding: '14px 16px', marginBottom: '24px',
          }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '10px', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              🔗 REFERRED BY
            </div>
            {referredBy ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontFamily: 'Space Mono, monospace', fontSize: '13px', color: 'var(--orange-soft)', letterSpacing: '0.04em' }}>
                    {referredBy}
                  </div>
                  <div style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '4px', padding: '2px 6px' }}>
                    applied
                  </div>
                </div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', marginTop: '6px' }}>
                  Referral codes can only be set once.
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                  <input
                    type="text"
                    value={refInput}
                    onChange={(e) => { setRefInput(e.target.value.slice(0, 20)); setRefMsg(''); }}
                    placeholder="Enter referral code..."
                    maxLength={20}
                    style={{
                      flex: 1, background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,107,0,0.25)', borderRadius: '8px',
                      color: '#fff', fontFamily: 'Space Mono, monospace',
                      fontSize: '13px', padding: '9px 12px',
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                  <button
                    disabled={refSaving || !refInput.trim()}
                    onClick={() => {
                      const code = refInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
                      if (!code) { setRefMsg('Enter a valid code'); return; }
                      setRefSaving(true);
                      localStorage.setItem(`referredBy_${wallet}`, code);
                      if (socket) socket.emit('register_referral', { referredWallet: wallet, referrerWallet: code });
                      setReferredBy(code);
                      setRefSaving(false);
                      setRefMsg('');
                    }}
                    style={{
                      padding: '9px 14px', borderRadius: '8px', fontSize: '12px',
                      fontFamily: 'var(--font-display)', fontWeight: 700,
                      border: 'none', cursor: refInput.trim() ? 'pointer' : 'not-allowed',
                      background: refInput.trim() ? 'linear-gradient(135deg,#cc5500,#ff8c00)' : 'rgba(255,255,255,0.06)',
                      color: refInput.trim() ? '#fff' : 'var(--text-muted)',
                      transition: 'all 0.2s', whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >
                    {refSaving ? '...' : 'Apply'}
                  </button>
                </div>
                {refMsg && <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '4px' }}>{refMsg}</div>}
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)' }}>
                  Can only be set once — cannot be changed after.
                </div>
              </>
            )}
          </div>

          {/* Avatar section */}
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '14px' }}>
            Profile Picture
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
              background: avatar ? 'transparent' : 'rgba(255,107,0,0.15)',
              border: '2px solid rgba(255,107,0,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '28px', cursor: 'pointer',
            }} onClick={() => fileRef.current?.click()}>
              {avatar
                ? <img src={avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : '🍓'}
            </div>
            <div style={{ flex: 1 }}>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={avatarSaving}
                style={{
                  padding: '8px 16px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
                  background: 'rgba(255,107,0,0.1)', border: '1px solid rgba(255,107,0,0.3)',
                  color: 'var(--orange-soft)', fontFamily: 'var(--font-display)', fontWeight: 700,
                }}
              >{avatarSaving ? 'Saving...' : 'Upload Image'}</button>
              <div style={{ fontSize: '10px', color: avatarMsg.startsWith('✓') ? '#10b981' : avatarMsg ? '#f87171' : 'var(--text-muted)', marginTop: '6px' }}>
                {avatarMsg || 'JPG, PNG, GIF · Max 2MB'}
              </div>
            </div>
          </div>

          {/* Level section */}
          {levelInfo && (
            <div style={{ marginBottom: '24px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '22px' }}>{levelInfo.emoji}</span>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                      Level {levelInfo.level} — {levelInfo.name}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {levelInfo.totalSol.toFixed(3)} SOL wagered
                    </div>
                  </div>
                </div>
                {levelInfo.nextTier && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'right' }}>
                    Next: {levelInfo.nextTier.emoji}<br />{levelInfo.nextTier.name}
                  </div>
                )}
              </div>
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '6px', height: '6px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${levelInfo.progress}%`, background: 'linear-gradient(90deg,#cc5500,#ff8c00)', borderRadius: '6px', transition: 'width 0.5s ease' }} />
              </div>
              {levelInfo.nextTier && (
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'right' }}>
                  {levelInfo.nextTier.minSol - levelInfo.totalSol > 0
                    ? `${(levelInfo.nextTier.minSol - levelInfo.totalSol).toFixed(3)} SOL to next level`
                    : 'Almost there!'}
                </div>
              )}
            </div>
          )}

          {/* Username section */}
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '14px' }}>
            Change Username
          </div>

          <div style={{ position: 'relative', marginBottom: '10px' }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => { setNewName(e.target.value.slice(0, 20)); setError(''); setSuccess(''); setAvailable(null); }}
              onKeyDown={handleKey}
              maxLength={20}
              placeholder="New username..."
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-primary)', border: `1px solid ${borderColor}`,
                borderRadius: '10px', color: 'var(--text-primary)',
                fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '15px',
                padding: '12px 44px 12px 14px', outline: 'none', transition: 'border-color 0.2s',
                boxShadow: error ? '0 0 0 3px rgba(252,92,101,0.1)' : (available === true || success) ? '0 0 0 3px rgba(16,185,129,0.1)' : 'none',
              }}
            />
            <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '15px' }}>
              {checking ? '⏳' : available === true ? '✅' : available === false ? '❌' : success ? '✅' : ''}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', minHeight: '18px' }}>
            <div style={{ fontSize: '12px' }}>
              {error && <span style={{ color: '#f87171' }}>{error}</span>}
              {!error && success && <span style={{ color: '#10b981' }}>✓ {success}</span>}
              {!error && !success && available === true && <span style={{ color: '#10b981' }}>✓ Username available</span>}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{newName.length}/20</div>
          </div>

          <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '16px' }}>
            Letters, numbers, spaces, _ - . allowed · 2–20 characters
          </div>

          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              width: '100%', padding: '12px',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px',
              border: 'none', borderRadius: '10px', letterSpacing: '0.03em',
              cursor: canSave ? 'pointer' : 'not-allowed',
              background: canSave ? 'linear-gradient(135deg,#cc5500,#ff8c00)' : 'rgba(255,255,255,0.06)',
              color: canSave ? '#fff' : 'var(--text-muted)',
              boxShadow: canSave ? '0 4px 20px rgba(204,85,0,0.35)' : 'none',
              transition: 'all 0.2s',
              marginBottom: '24px',
            }}
          >
            {saving ? 'Saving...' : checking ? 'Checking...' : 'Save Username'}
          </button>

          {/* MOD TOOLS */}
          {wallet === '9QeT88EePX6w7DsTWe5Tpx9s5go6QfxrUtpxtFeznfxi' && (
          <div style={{
            background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: '12px', padding: '14px 16px',
          }}>
            <div style={{ fontSize: '10px', color: 'rgba(239,68,68,0.7)', letterSpacing: '0.12em', marginBottom: '14px', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
              🛡️ MOD TOOLS
            </div>

            {/* FruitRoll Always Lose toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)', marginBottom: '3px' }}>
                  FruitRoll — Force Lose
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Players can never win — always picks a different fruit
                </div>
              </div>
              <div
                onClick={toggleFruitRollAlwaysLose}
                style={{
                  position: 'relative', width: '44px', height: '24px', borderRadius: '12px',
                  background: fruitRollAlwaysLose ? '#ef4444' : 'rgba(255,255,255,0.1)',
                  border: `1px solid ${fruitRollAlwaysLose ? '#ef4444' : 'var(--border-color)'}`,
                  cursor: 'pointer', transition: 'background 0.2s, border-color 0.2s',
                  flexShrink: 0,
                  boxShadow: fruitRollAlwaysLose ? '0 0 10px rgba(239,68,68,0.4)' : 'none',
                }}
              >
                <div style={{
                  position: 'absolute', top: '3px',
                  left: fruitRollAlwaysLose ? '23px' : '3px',
                  width: '16px', height: '16px', borderRadius: '50%',
                  background: '#fff', transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                }} />
              </div>
            </div>

            {fruitRollAlwaysLose && (
              <div style={{
                marginTop: '10px', padding: '8px 10px',
                background: 'rgba(239,68,68,0.1)', borderRadius: '8px',
                fontSize: '11px', color: '#f87171', fontFamily: 'var(--font-display)', fontWeight: 600,
              }}>
                ⚠️ ACTIVE — FruitRoll players cannot win
              </div>
            )}

            <div style={{ height: '1px', background: 'rgba(239,68,68,0.15)', margin: '14px 0' }} />

            {/* Game Lock Controls */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)', marginBottom: '10px' }}>
                🔒 Lock / Unlock Games
              </div>
              {(['fruitbowl', 'fruitroll'] as const).map((game) => {
                const isLocked = lockedGames.includes(game);
                return (
                  <div key={game} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '11px', color: isLocked ? '#f87171' : 'var(--text-primary)' }}>
                        {game === 'fruitbowl' ? '🍊 Fruitbowl Wheel' : '🎰 FruitRoll Slots'}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {isLocked ? '🔴 Locked — no new bets accepted' : '🟢 Open — accepting bets'}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleGameLock(game)}
                      style={{
                        padding: '6px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                        background: isLocked ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                        color: isLocked ? '#10b981' : '#f87171',
                        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px',
                        transition: 'all 0.2s', whiteSpace: 'nowrap', flexShrink: 0,
                        boxShadow: isLocked ? '0 0 8px rgba(16,185,129,0.3)' : 'none',
                      }}
                    >
                      {isLocked ? '🔓 Unlock' : '🔒 Lock'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div style={{ height: '1px', background: 'rgba(239,68,68,0.15)', margin: '14px 0' }} />

            {/* Clear Chat */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)', marginBottom: '3px' }}>
                  Clear Entire Chat
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Wipes all messages for every connected user
                </div>
              </div>
              <button
                onClick={handleClearChat}
                style={{
                  padding: '7px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  background: clearChatConfirm ? '#ef4444' : 'rgba(239,68,68,0.15)',
                  color: clearChatConfirm ? '#fff' : '#f87171',
                  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px',
                  transition: 'all 0.2s', whiteSpace: 'nowrap', flexShrink: 0,
                  boxShadow: clearChatConfirm ? '0 0 12px rgba(239,68,68,0.5)' : 'none',
                }}
              >
                {clearChatConfirm ? '⚠️ Confirm' : '🗑️ Clear'}
              </button>
            </div>
            {clearChatMsg && (
              <div style={{ marginTop: '8px', fontSize: '11px', color: clearChatMsg.startsWith('✓') ? '#10b981' : '#f87171', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                {clearChatMsg}
              </div>
            )}
            {clearChatConfirm && (
              <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)' }}>
                Click again to confirm — this cannot be undone
              </div>
            )}

            <div style={{ height: '1px', background: 'rgba(239,68,68,0.15)', margin: '14px 0' }} />

            {/* Force Close Current Round */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)', marginBottom: '3px' }}>
                  Force Close Round
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Immediately ends the current round, no winner
                </div>
              </div>
              <button
                onClick={handleCloseGame}
                style={{
                  padding: '7px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  background: closeGameConfirm ? '#ef4444' : 'rgba(239,68,68,0.15)',
                  color: closeGameConfirm ? '#fff' : '#f87171',
                  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '11px',
                  transition: 'all 0.2s', whiteSpace: 'nowrap', flexShrink: 0,
                  boxShadow: closeGameConfirm ? '0 0 12px rgba(239,68,68,0.5)' : 'none',
                }}
              >
                {closeGameConfirm ? '⚠️ Confirm' : '⏹ Close'}
              </button>
            </div>
            {closeGameMsg && (
              <div style={{ marginTop: '8px', fontSize: '11px', color: closeGameMsg.startsWith('✓') ? '#10b981' : '#f87171', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                {closeGameMsg}
              </div>
            )}
            {closeGameConfirm && (
              <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)' }}>
                Click again to confirm — bets will not be refunded
              </div>
            )}

            <div style={{ height: '1px', background: 'rgba(239,68,68,0.15)', margin: '14px 0' }} />

            {/* Pause Referral Payouts */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)', marginBottom: '3px' }}>
                  Pause Referral Payouts
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Prevents anyone from claiming referral earnings
                </div>
              </div>
              <div
                onClick={toggleReferralPayoutsPause}
                style={{
                  position: 'relative', width: '44px', height: '24px', borderRadius: '12px',
                  background: referralPayoutsPaused ? '#ef4444' : 'rgba(255,255,255,0.1)',
                  border: `1px solid ${referralPayoutsPaused ? '#ef4444' : 'var(--border-color)'}`,
                  cursor: 'pointer', transition: 'background 0.2s, border-color 0.2s',
                  flexShrink: 0,
                  boxShadow: referralPayoutsPaused ? '0 0 10px rgba(239,68,68,0.4)' : 'none',
                }}
              >
                <div style={{
                  position: 'absolute', top: '3px',
                  left: referralPayoutsPaused ? '23px' : '3px',
                  width: '16px', height: '16px', borderRadius: '50%',
                  background: '#fff', transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                }} />
              </div>
            </div>
            {referralPayoutsPaused && (
              <div style={{
                marginTop: '10px', padding: '8px 10px',
                background: 'rgba(239,68,68,0.1)', borderRadius: '8px',
                fontSize: '11px', color: '#f87171', fontFamily: 'var(--font-display)', fontWeight: 600,
              }}>
                ⏸ ACTIVE — Referral claims are blocked
              </div>
            )}
            {referralPauseMsg && (
              <div style={{ marginTop: '8px', fontSize: '11px', color: referralPayoutsPaused ? '#f87171' : '#10b981', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                {referralPauseMsg}
              </div>
            )}
          </div>
          )}

        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid var(--border-color)',
          background: 'rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'center',
        }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.7 }}>
            FruitBowl.fun · 5% house edge · Solana Mainnet
          </div>
        </div>
      </div>
    </div>
  );
}

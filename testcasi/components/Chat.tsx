import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';

interface LevelInfo {
  level: number;
  name: string;
  emoji: string;
  progress: number;
  nextTier: { name: string; minSol: number } | null;
  totalSol: number;
}

interface ChatMessage {
  id: string;
  wallet: string;
  displayName: string;
  message: string;
  timestamp: number;
  isMod?: boolean;
  avatar?: string | null;
  level?: LevelInfo | null;
}

interface ChatProps {
  socket: Socket | null;
  currentWallet: string | null;
  currentDisplayName: string;
  isConnected: boolean;
  isMod?: boolean;
}

const COLORS = [
  '#a78bfa', '#60a5fa', '#34d399', '#f472b6', '#fb923c',
  '#e879f9', '#38bdf8', '#4ade80', '#fbbf24', '#f87171',
];

function getColor(wallet: string): string {
  let hash = 0;
  for (let i = 0; i < wallet.length; i++) hash = wallet.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function shortenWallet(w: string) { return w.slice(0, 4) + '…' + w.slice(-4); }

function getLevelBg(level: number): string {
  if (level >= 100) return 'linear-gradient(135deg, #b8860b, #ffd700)';
  if (level >= 90)  return 'linear-gradient(135deg, #6a0dad, #9b30ff)';
  if (level >= 70)  return 'linear-gradient(135deg, #1a6b3a, #26de81)';
  if (level >= 50)  return 'linear-gradient(135deg, #1a4d8c, #45aaff)';
  if (level >= 30)  return 'linear-gradient(135deg, #7a3500, #ff6b00)';
  if (level >= 10)  return 'linear-gradient(135deg, #5a2d00, #a05020)';
  return 'linear-gradient(135deg, #2a2a2a, #444)';
}

export default function Chat({ socket, currentWallet, currentDisplayName, isConnected, isMod = false }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [cooldown, setCooldown] = useState(false);
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const [avatarCache, setAvatarCache] = useState<Record<string, string | null>>({});
  const [playerCount, setPlayerCount] = useState<number>(0);
  const [contextMenu, setContextMenu] = useState<{ msgId: string; targetWallet: string; x: number; y: number } | null>(null);
  const [mutedWallets, setMutedWallets] = useState<Set<string>>(new Set());
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socket) return;
    const onHistory = (history: ChatMessage[]) => {
      setMessages(history);
      const cache: Record<string, string | null> = {};
      history.forEach(m => { if (m.avatar !== undefined) cache[m.wallet] = m.avatar; });
      setAvatarCache(prev => ({ ...prev, ...cache }));
    };
    const onMessage = (msg: ChatMessage) => {
      if (mutedWallets.has(msg.wallet)) return; // silently drop muted users
      if (msg.avatar !== undefined) setAvatarCache(prev => ({ ...prev, [msg.wallet]: msg.avatar ?? null }));
      setMessages(prev => {
        const filtered = prev.filter(m => {
          if (m.id.startsWith('local-') && m.wallet === msg.wallet && m.message === msg.message) return false;
          if (m.id === msg.id) return false;
          return true;
        });
        return [...filtered.slice(-199), msg];
      });
    };
    const onAvatarUpdated = ({ wallet, avatar }: { wallet: string; avatar: string | null }) => {
      setAvatarCache(prev => ({ ...prev, [wallet]: avatar }));
    };
    const onCooldown = ({ msLeft }: { msLeft: number }) => {
      const secs = Math.ceil(msLeft / 1000);
      setCooldown(true); setCooldownSecs(secs);
      let s = secs;
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      cooldownRef.current = setInterval(() => {
        s -= 1; setCooldownSecs(s);
        if (s <= 0) { clearInterval(cooldownRef.current!); setCooldown(false); setCooldownSecs(0); }
      }, 1000);
    };
    const onPlayerCount = (count: number) => setPlayerCount(count);
    const onMutedUser = ({ targetWallet }: { targetWallet: string }) => {
      setMutedWallets(prev => new Set(Array.from(prev).concat(targetWallet)));
      setMessages(prev => prev.filter(m => m.wallet !== targetWallet));
    };
    const onMessageDeleted = ({ messageId }: { messageId: string }) => {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    };
    const onChatCleared = () => {
      setMessages([]);
    };
    socket.on('chat_history', onHistory);
    socket.on('chat_message', onMessage);
    socket.on('avatar_updated', onAvatarUpdated);
    socket.on('chat_cooldown', onCooldown);
    socket.on('player_count', onPlayerCount);
    socket.on('muted_user', onMutedUser);
    socket.on('message_deleted', onMessageDeleted);
    socket.on('chat_cleared', onChatCleared);
    socket.emit('get_chat_history');
    return () => {
      socket.off('chat_history', onHistory);
      socket.off('chat_message', onMessage);
      socket.off('avatar_updated', onAvatarUpdated);
      socket.off('chat_cooldown', onCooldown);
      socket.off('player_count', onPlayerCount);
      socket.off('muted_user', onMutedUser);
      socket.off('message_deleted', onMessageDeleted);
      socket.off('chat_cleared', onChatCleared);
    };
  }, [socket]);

  useEffect(() => {
    if (isConnected && socket) socket.emit('get_chat_history');
  }, [isConnected, socket]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sendMessage = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !currentWallet || !socket || cooldown) return;
    const displayName = currentDisplayName || shortenWallet(currentWallet);
    const optimisticMsg: ChatMessage = {
      id: `local-${Date.now()}-${Math.random()}`,
      wallet: currentWallet, displayName, message: trimmed, timestamp: Date.now(),
    };
    setMessages(prev => [...prev.slice(-199), optimisticMsg]);
    setInput('');
    setCooldown(true); setCooldownSecs(3);
    let secs = 3;
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      secs -= 1; setCooldownSecs(secs);
      if (secs <= 0) { clearInterval(cooldownRef.current!); setCooldown(false); setCooldownSecs(0); }
    }, 1000);
    socket.emit('send_chat', { wallet: currentWallet, displayName, message: trimmed });
  }, [input, currentWallet, currentDisplayName, socket, cooldown]);

  const handleModMute = useCallback((targetWallet: string) => {
    if (!socket || !currentWallet) return;
    socket.emit('mod_mute_user', { wallet: currentWallet, targetWallet });
    setContextMenu(null);
  }, [socket, currentWallet]);

  const handleModDelete = useCallback((messageId: string) => {
    if (!socket || !currentWallet) return;
    socket.emit('mod_delete_message', { wallet: currentWallet, messageId });
    setContextMenu(null);
  }, [socket, currentWallet]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const canChat = !!currentWallet && !!socket;
  const placeholder = !currentWallet ? 'Connect wallet to chat'
    : !socket ? 'Connecting...'
    : cooldown ? `Wait ${cooldownSecs}s...`
    : currentDisplayName ? `Message as ${currentDisplayName}...`
    : 'Say something...';

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--chat-bg)' }}
      onClick={() => setContextMenu(null)}
    >

      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'rgba(255,255,255,0.02)', flexShrink: 0,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: isConnected ? '#10b981' : '#ef4444', boxShadow: isConnected ? '0 0 6px #10b981' : 'none', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>Live Chat</span>
        {!isConnected && <span style={{ fontSize: '10px', color: '#ef4444' }}>reconnecting…</span>}
        <div title="Players online" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 5px #10b981' }} />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>{playerCount} online</span>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'hidden', padding: '4px 0', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', marginTop: '48px', lineHeight: 1.8 }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>💬</div>
            No messages yet.<br />Be the first to chat!
          </div>
        )}
        {messages.map((msg) => {
          const isOwn = msg.wallet === currentWallet;
          const color = getColor(msg.wallet);
          const name = msg.displayName || shortenWallet(msg.wallet);
          const isOptimistic = msg.id.startsWith('local-');
          const avatar = avatarCache[msg.wallet];
          const lvl = msg.level;
          return (
            <div key={msg.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                padding: '8px 14px',
                background: isOwn ? 'rgba(255,140,0,0.04)' : 'transparent',
                opacity: isOptimistic ? 0.6 : 1,
                transition: 'background 0.1s',
                position: 'relative',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
              onMouseLeave={e => (e.currentTarget.style.background = isOwn ? 'rgba(255,140,0,0.04)' : 'transparent')}
              onContextMenu={isMod && !isOwn ? (e) => {
                e.preventDefault();
                setContextMenu({ msgId: msg.id, targetWallet: msg.wallet, x: e.clientX, y: e.clientY });
              } : undefined}
            >
              {/* Level badge */}
              <div
                title={lvl ? `Level ${lvl.level} — ${lvl.name}` : 'Level 0 — Seedling'}
                style={{
                  flexShrink: 0, width: 38, height: 38, borderRadius: '8px',
                  background: getLevelBg(lvl?.level ?? 0),
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  cursor: 'default', gap: '1px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                }}
              >
                <span style={{ fontSize: '15px', lineHeight: 1 }}>{lvl?.emoji ?? '🌱'}</span>
                <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.9)', fontFamily: 'var(--font-display)', fontWeight: 800, lineHeight: 1 }}>
                  {lvl?.level ?? 0}
                </span>
              </div>

              {/* Right side */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Name row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
                  {/* Avatar bubble */}
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                    overflow: 'hidden', border: `1px solid ${color}`,
                    background: avatar ? 'transparent' : color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '8px', color: '#fff', fontWeight: 700,
                  }}>
                    {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : name.charAt(0).toUpperCase()}
                  </div>

                  <span style={{ fontSize: '13px', fontWeight: 700, color, fontFamily: 'var(--font-display)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '110px' }}>
                    {name}
                  </span>

                  {msg.isMod && (
                    <span title="Moderator" style={{ width: 13, height: 13, borderRadius: '50%', background: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', flexShrink: 0, color: '#fff' }}>✓</span>
                  )}
                  {msg.isMod && (
                    <span style={{ fontSize: '8px', background: 'rgba(139,92,246,0.25)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.4)', borderRadius: '4px', padding: '1px 5px', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.04em', flexShrink: 0 }}>MOD</span>
                  )}

                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>
                    {formatTime(msg.timestamp)}
                  </span>
                </div>

                {/* Message text */}
                <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {msg.message}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 280))}
            onKeyDown={handleKey}
            placeholder={placeholder}
            disabled={!canChat}
            style={{
              flex: 1, fontSize: '12px', padding: '9px 12px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
              color: 'var(--text-primary)', outline: 'none', opacity: canChat ? 1 : 0.5,
            }}
            maxLength={280}
          />
          <button
            onClick={sendMessage}
            disabled={!canChat || !input.trim() || cooldown}
            style={{
              padding: '9px 14px', fontSize: '14px', borderRadius: '10px', flexShrink: 0,
              background: canChat && input.trim() && !cooldown ? 'linear-gradient(135deg,#cc5500,#ff8c00)' : 'rgba(255,255,255,0.06)',
              border: 'none', color: '#fff', cursor: canChat && !cooldown ? 'pointer' : 'not-allowed',
              fontWeight: 700, transition: 'all 0.15s',
            }}
          >
            {cooldown ? cooldownSecs : '›'}
          </button>
        </div>
        {!canChat && (
          <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
            Please connect wallet to chat
          </div>
        )}
      </div>
      {/* Mod context menu */}
      {isMod && contextMenu && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999,
            background: '#1a0a00',
            border: '1px solid rgba(139,92,246,0.5)',
            borderRadius: '10px',
            padding: '6px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
            minWidth: '160px',
          }}
        >
          <div style={{
            fontSize: '9px', color: '#a78bfa', fontFamily: 'var(--font-display)',
            fontWeight: 800, letterSpacing: '0.08em', padding: '4px 8px 6px',
            borderBottom: '1px solid rgba(139,92,246,0.2)', marginBottom: '4px',
          }}>⚡ MOD ACTIONS</div>
          <button
            onClick={() => handleModDelete(contextMenu.msgId)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'transparent', border: 'none', color: '#f87171',
              fontSize: '12px', padding: '7px 10px', borderRadius: '6px',
              cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 600,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >🗑️ Delete Message</button>
          <button
            onClick={() => handleModMute(contextMenu.targetWallet)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'transparent', border: 'none', color: '#fb923c',
              fontSize: '12px', padding: '7px 10px', borderRadius: '6px',
              cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 600,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251,146,60,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >🔇 Mute User</button>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';

interface ChatMessage {
  id: string;
  wallet: string;
  displayName: string;
  message: string;
  timestamp: number;
}

interface ChatProps {
  socket: Socket | null;
  currentWallet: string | null;
  currentDisplayName: string;
  isConnected: boolean;
}

const COLORS = [
  '#a78bfa', '#60a5fa', '#34d399', '#f472b6', '#fb923c',
  '#e879f9', '#38bdf8', '#4ade80', '#fbbf24', '#f87171',
];

function getColor(wallet: string): string {
  let hash = 0;
  for (let i = 0; i < wallet.length; i++) {
    hash = wallet.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function shortenWallet(wallet: string): string {
  return wallet.slice(0, 4) + '…' + wallet.slice(-4);
}

export default function Chat({ socket, currentWallet, currentDisplayName, isConnected }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Always hold latest values without triggering re-subscription
  const socketRef = useRef<Socket | null>(null);
  const walletRef = useRef<string | null>(null);
  const displayNameRef = useRef<string>('');

  socketRef.current = socket;
  walletRef.current = currentWallet;
  displayNameRef.current = currentDisplayName;

  // Subscribe to socket events — re-run whenever socket instance changes
  useEffect(() => {
    if (!socket) return;

    const onHistory = (history: ChatMessage[]) => {
      setMessages(history);
    };
    const onMessage = (msg: ChatMessage) => {
      setMessages(prev => {
        // Deduplicate by id in case of optimistic echo
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev.slice(-199), msg];
      });
    };

    socket.on('chat_history', onHistory);
    socket.on('chat_message', onMessage);

    // Request history on (re)connect
    socket.emit('get_chat_history');

    return () => {
      socket.off('chat_history', onHistory);
      socket.off('chat_message', onMessage);
    };
  }, [socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(() => {
    const s = socketRef.current;
    const w = walletRef.current;
    const trimmed = input.trim();
    if (!trimmed || !w) return;

    const optimisticMsg: ChatMessage = {
      id: `local-${Date.now()}-${Math.random()}`,
      wallet: w,
      displayName: displayNameRef.current || shortenWallet(w),
      message: trimmed,
      timestamp: Date.now(),
    };

    // Show message immediately (optimistic)
    setMessages(prev => [...prev.slice(-199), optimisticMsg]);
    setInput('');

    if (s) {
      s.emit('send_chat', {
        wallet: w,
        displayName: displayNameRef.current || shortenWallet(w),
        message: trimmed,
      });
    }
  }, [input]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--chat-bg)' }}>

      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'rgba(139,92,246,0.04)',
        flexShrink: 0,
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: isConnected ? '#10b981' : '#ef4444',
          boxShadow: isConnected ? '0 0 6px #10b981' : 'none',
          flexShrink: 0,
        }} />
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 700,
          fontSize: '12px', color: 'var(--text-secondary)', letterSpacing: '0.1em',
        }}>LIVE CHAT</span>
        <span style={{
          marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)',
          background: 'rgba(139,92,246,0.1)', padding: '2px 7px',
          borderRadius: '20px', border: '1px solid rgba(139,92,246,0.15)',
        }}>
          {messages.length}
        </span>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: '6px',
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center', color: 'var(--text-muted)',
            fontSize: '12px', marginTop: '48px', lineHeight: 1.8,
          }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>💬</div>
            No messages yet.<br />Be the first to chat!
          </div>
        )}
        {messages.map((msg) => {
          const isOwn = msg.wallet === currentWallet;
          const color = getColor(msg.wallet);
          const name = msg.displayName || shortenWallet(msg.wallet);
          return (
            <div key={msg.id} className="animate-slide-in-up"
              style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexDirection: isOwn ? 'row-reverse' : 'row' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color, fontFamily: 'var(--font-display)' }}>{name}</span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{formatTime(msg.timestamp)}</span>
              </div>
              <div style={{
                background: isOwn ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isOwn ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: isOwn ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                padding: '7px 11px', fontSize: '12px', color: 'var(--text-primary)',
                maxWidth: '95%', wordBreak: 'break-word', lineHeight: 1.5,
              }}>
                {msg.message}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid var(--border-color)',
        display: 'flex', gap: '8px', flexShrink: 0,
      }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 280))}
          onKeyDown={handleKey}
          placeholder={
            !currentWallet ? 'Connect wallet to chat'
            : currentDisplayName ? `Chat as ${currentDisplayName}...`
            : 'Say something...'
          }
          disabled={!currentWallet}
          style={{ flex: 1, fontSize: '12px', padding: '8px 10px', borderRadius: '8px' }}
          maxLength={280}
        />
        <button
          onClick={sendMessage}
          disabled={!currentWallet || !input.trim()}
          className="btn-orange"
          style={{ padding: '8px 13px', fontSize: '14px', borderRadius: '8px', flexShrink: 0 }}
        >
          ›
        </button>
      </div>
    </div>
  );
}

const { Server } = require('socket.io');
const {
  getOrCreateActiveRound,
  getCurrentRound,
  placeBet,
  spinRound,
  endRound,
  upsertUser,
  changeUsername,
  isUsernameTaken,
  addChatMessage,
  getChatHistory,
  getRecentRounds,
} = require('./gameStore.js');

const SPIN_DURATION_MS = 6000;

let countdownTimeout = null;

function broadcastRound(io, round) {
  io.emit('round_update', round);
}

function startCountdown(io) {
  if (countdownTimeout) { clearTimeout(countdownTimeout); countdownTimeout = null; }
  const round = getCurrentRound();
  if (!round || round.status !== 'active') return;
  const msLeft = round.countdownEndsAt - Date.now();
  countdownTimeout = setTimeout(() => triggerSpin(io), Math.max(0, msLeft));
}

function triggerSpin(io) {
  const round = getCurrentRound();
  if (!round || round.status !== 'active') return;

  const spun = spinRound(round.id);
  if (!spun) return;

  io.emit('spin_started');
  broadcastRound(io, spun);

  setTimeout(() => {
    io.emit('winner_announced', {
      winnerWallet: spun.winnerWallet,
      winnerDisplayName: spun.winnerDisplayName,
      winnerShare: spun.winnerShare,
      totalPot: spun.totalPot,
    });

    setTimeout(() => {
      endRound(spun.id);
      // Broadcast updated recent rounds to everyone
      io.emit('recent_rounds', getRecentRounds());
      const newRound = getOrCreateActiveRound();
      io.emit('new_round');
      broadcastRound(io, newRound);
    }, 5000);
  }, SPIN_DURATION_MS);
}

function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Send full initial state
    const round = getOrCreateActiveRound();
    socket.emit('round_update', round);
    socket.emit('chat_history', getChatHistory(50));
    socket.emit('recent_rounds', getRecentRounds());

    socket.on('get_state', () => {
      const r = getOrCreateActiveRound();
      socket.emit('round_update', r);
      socket.emit('chat_history', getChatHistory(50));
      socket.emit('recent_rounds', getRecentRounds());
    });

    // Chat.tsx requests history with this event on mount
    socket.on('get_chat_history', () => {
      socket.emit('chat_history', getChatHistory(50));
    });

    socket.on('register_user', ({ wallet, displayName }) => {
      if (!wallet) return;
      upsertUser(wallet, displayName || wallet.slice(0, 8));
    });

    // Check if a username is available — uses regular emit (no callbacks, proxy-safe)
    socket.on('check_username', ({ name, wallet }) => {
      const trimmed = (name || '').trim();
      if (!trimmed || trimmed.length < 2) { socket.emit('username_check_result', { available: false, error: 'Too short' }); return; }
      if (trimmed.length > 20) { socket.emit('username_check_result', { available: false, error: 'Too long' }); return; }
      if (!/^[a-zA-Z0-9_\-. ]+$/.test(trimmed)) { socket.emit('username_check_result', { available: false, error: 'Invalid characters' }); return; }
      const taken = isUsernameTaken(trimmed, wallet || null);
      socket.emit('username_check_result', { available: !taken, error: taken ? 'Username already taken' : null });
    });

    // Change username — uses regular emit (no callbacks, proxy-safe)
    socket.on('change_username', ({ wallet, newName }) => {
      if (!wallet) { socket.emit('username_change_result', { success: false, error: 'No wallet' }); return; }
      const result = changeUsername(wallet, newName);
      socket.emit('username_change_result', result);
      if (result.success) {
        io.emit('username_changed', { wallet, newName: result.user.displayName });
      }
    });

    socket.on('place_bet', ({ wallet, displayName, amountLamports }) => {
      if (!wallet || !amountLamports) return;
      const result = placeBet(wallet, displayName, amountLamports);
      if (!result.success) { socket.emit('bet_error', { error: result.error }); return; }
      broadcastRound(io, result.round);
      if (result.round.status === 'active' && result.round.players.length === 2) {
        startCountdown(io);
      }
    });

    socket.on('send_chat', ({ wallet, displayName, message }) => {
      if (!wallet || !message?.trim()) return;
      const msg = addChatMessage(wallet, displayName, message.trim());
      io.emit('chat_message', msg);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}

module.exports = { initSocket: initSocketServer };

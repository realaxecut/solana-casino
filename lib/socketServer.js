const { Server } = require('socket.io');
const {
  getOrCreateActiveRound,
  getCurrentRound,
  placeBet,
  spinRound,
  endRound,
  upsertUser,
  addChatMessage,
  getChatHistory,
} = require('./gameStore.js');

const COUNTDOWN_SECONDS = 60; // 60 second countdown
const SPIN_DURATION_MS = 6000; // how long the spin animation lasts before announcing winner

let countdownTimeout = null;

function broadcastRound(io, round) {
  io.emit('round_update', round);
}

function startCountdown(io) {
  if (countdownTimeout) {
    clearTimeout(countdownTimeout);
    countdownTimeout = null;
  }

  const round = getCurrentRound();
  if (!round || round.status !== 'active') return;

  const msLeft = round.countdownEndsAt - Date.now();

  // Spin immediately when timer hits 0 — no extra delay
  countdownTimeout = setTimeout(() => {
    triggerSpin(io);
  }, Math.max(0, msLeft));
}

function triggerSpin(io) {
  const round = getCurrentRound();
  if (!round || round.status !== 'active') return;

  const spun = spinRound(round.id);
  if (!spun) return;

  io.emit('spin_started');
  broadcastRound(io, spun);

  // After spin animation completes, announce winner and reset
  setTimeout(() => {
    io.emit('winner_announced', {
      winnerWallet: spun.winnerWallet,
      winnerDisplayName: spun.winnerDisplayName,
      winnerShare: spun.winnerShare,
      totalPot: spun.totalPot,
    });

    setTimeout(() => {
      endRound(spun.id);
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

    // Send current state on join
    const round = getOrCreateActiveRound();
    socket.emit('round_update', round);
    socket.emit('chat_history', getChatHistory(50));

    socket.on('get_state', () => {
      const r = getOrCreateActiveRound();
      socket.emit('round_update', r);
      socket.emit('chat_history', getChatHistory(50));
    });

    socket.on('register_user', ({ wallet, displayName }) => {
      if (!wallet) return;
      upsertUser(wallet, displayName || wallet.slice(0, 8));
    });

    socket.on('place_bet', ({ wallet, displayName, amountLamports }) => {
      if (!wallet || !amountLamports) return;

      const result = placeBet(wallet, displayName, amountLamports);
      if (!result.success) {
        socket.emit('bet_error', { error: result.error });
        return;
      }

      broadcastRound(io, result.round);

      // Start countdown the moment 2nd player joins
      if (result.round.status === 'active' && result.round.players.length === 2) {
        startCountdown(io);
      }
    });

    socket.on('chat_message', ({ wallet, displayName, message }) => {
      if (!wallet || !message) return;
      const msg = addChatMessage(wallet, displayName, message);
      io.emit('chat_message', msg);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}

module.exports = { initSocket: initSocketServer };

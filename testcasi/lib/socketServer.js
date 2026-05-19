const { Server } = require('socket.io');
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const bs58 = require('bs58');
const {
  getOrCreateActiveRound,
  getCurrentRound,
  placeBet,
  spinRound,
  endRound,
  forceEndCurrentRound,
  upsertUser,
  changeUsername,
  isUsernameTaken,
  addChatMessage,
  getChatHistory,
  getRecentRounds,
  setAvatar,
  getAvatar,
  getUser,
  recordWin,
  isModerator,
  deleteMessage,
  muteUser,
  deleteChatByWallet,
  clearAllChat,
  lockGame,
  unlockGame,
  isGameLocked,
  getLockedGames,
  setReferral,
  getReferrer,
  getReferralStats,
  getReferralEarnings,
  recordReferralBonus,
  queueReferralWinBonus,
  queueReferralLossBonus,
  getPendingReferralEarnings,
  getClaimedReferralEarnings,
  getTotalUnclaimedReferral,
  getTotalClaimedReferral,
  lockReferralClaimsForPayout,
  finalizeReferralClaims,
  rollbackReferralClaims,
  setReferralSlug,
  getReferralSlug,
  resolveSlug,
  getModSetting,
  setModSetting,
  isReferralPayoutsPaused,
} = require('./gameStore.js');
const { getLevel, LEVELS } = require('./levels.js');
const { db, stmts } = require('./db.js');

const SPIN_DURATION_MS = 6000;
const RPC_URL = process.env.SERVER_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

let houseKeypair = null;
let solanaConnection = null;

function initSolana() {
  let privKey = process.env.HOUSE_WALLET_PRIVATE_KEY;

  // Fallback: try loading the raw secret key bytes from house-wallet.json
  if (!privKey) {
    try {
      const path = require('path');
      const fs = require('fs');
      const jsonPath = path.join(__dirname, '..', 'house-wallet.json');
      if (fs.existsSync(jsonPath)) {
        const rawBytes = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const secretKey = Uint8Array.from(rawBytes);
        houseKeypair = Keypair.fromSecretKey(secretKey);
        solanaConnection = new Connection(RPC_URL, 'confirmed');
        console.log('[payout] House wallet loaded from house-wallet.json:', houseKeypair.publicKey.toBase58());
        return;
      }
    } catch (e) {
      console.error('[payout] Failed to load house-wallet.json:', e.message);
    }
    console.warn('[payout] HOUSE_WALLET_PRIVATE_KEY not set and house-wallet.json not found — payouts disabled');
    return;
  }
  try {
    const decoded = bs58.decode(privKey);
    houseKeypair = Keypair.fromSecretKey(decoded);
    solanaConnection = new Connection(RPC_URL, 'confirmed');
    console.log('[payout] House wallet loaded:', houseKeypair.publicKey.toBase58());
  } catch (e) {
    console.error('[payout] Failed to load house keypair:', e.message);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// On devnet the public RPC aggressively rate-limits getTransaction calls.
// We detect 429s and back off, and on devnet we trust the tx after confirmation
// rather than re-fetching it (the client already confirmed it before submitting).
const IS_DEVNET = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet') !== 'mainnet-beta';

async function verifyBetTransaction(txSignature, expectedSender, expectedReceiver, expectedLamports) {
  if (!solanaConnection) {
    console.error('[verify] No solana connection — cannot verify tx');
    return false;
  }

  // On devnet: trust the signature — the client confirmed it before sending us the sig.
  // Doing a getTransaction call on the free devnet RPC causes 429s that block the whole game.
  if (IS_DEVNET) {
    console.log(`[verify] Devnet mode — trusting confirmed tx from ${expectedSender}: ${txSignature}`);
    return true;
  }

  // Mainnet: fetch and validate the transaction with exponential backoff on 429s
  let tx = null;
  let delayMs = 3000;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      tx = await solanaConnection.getTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (tx) break;
      console.log(`[verify] Attempt ${attempt}: tx not found yet, retrying in ${delayMs}ms...`);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 1.5, 15000);
    } catch (e) {
      const is429 = e.message?.includes('429') || e.message?.includes('Too many');
      console.error(`[verify] Attempt ${attempt} ${is429 ? '(rate limited)' : 'error'}:`, e.message);
      await sleep(is429 ? delayMs * 2 : delayMs);
      delayMs = Math.min(delayMs * 1.5, 15000);
    }
  }
  if (!tx) {
    console.warn('[verify] Transaction never found on-chain:', txSignature);
    return false;
  }
  if (tx.meta?.err) {
    console.warn('[verify] Transaction failed on-chain:', txSignature, tx.meta.err);
    return false;
  }
  const accounts = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
  if (!accounts || accounts.length < 2) {
    console.warn('[verify] Unexpected account layout in tx:', txSignature);
    return false;
  }
  const senderKey = accounts[0].toBase58();
  const receiverKey = accounts[1].toBase58();
  if (senderKey !== expectedSender) {
    console.warn('[verify] Sender mismatch:', senderKey, '!==', expectedSender);
    return false;
  }
  if (receiverKey !== expectedReceiver) {
    console.warn('[verify] Receiver mismatch:', receiverKey, '!==', expectedReceiver);
    return false;
  }
  const receiverDelta = tx.meta.postBalances[1] - tx.meta.preBalances[1];
  if (receiverDelta < expectedLamports) {
    console.warn('[verify] Amount mismatch: expected', expectedLamports, 'got delta', receiverDelta);
    return false;
  }
  console.log(`[verify] ✓ Verified ${expectedLamports} lamports from ${expectedSender} — tx: ${txSignature}`);
  return true;
}

async function sendPayout(winnerWallet, lamports) {
  if (!houseKeypair || !solanaConnection) {
    console.warn('[payout] Skipping payout — not configured');
    return null;
  }
  let lastError = null;
  let delayMs = 2000;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const toPubkey = new PublicKey(winnerWallet);
      const { blockhash, lastValidBlockHeight } = await solanaConnection.getLatestBlockhash('confirmed');
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: houseKeypair.publicKey,
          toPubkey,
          lamports,
        })
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer = houseKeypair.publicKey;
      tx.sign(houseKeypair);
      const sig = await solanaConnection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await solanaConnection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      console.log(`[payout] Sent ${lamports / LAMPORTS_PER_SOL} SOL to ${winnerWallet} — tx: ${sig}`);
      return sig;
    } catch (e) {
      lastError = e;
      const is429 = e.message?.includes('429') || e.message?.includes('Too many');
      console.error(`[payout] Attempt ${attempt} failed${is429 ? ' (rate limited)' : ''}:`, e.message);
      if (attempt < 4) {
        await sleep(is429 ? delayMs * 2 : delayMs);
        delayMs = Math.min(delayMs * 2, 12000);
      }
    }
  }
  console.error('[payout] All payout attempts failed:', lastError?.message);
  return null;
}

let countdownTimeout = null;

function broadcastRound(io, round) {
  io.emit('round_update', round);
}

function broadcastPlayerCount(io) {
  io.emit('player_count', io.engine.clientsCount);
}

function startCountdown(io) {
  if (countdownTimeout) { clearTimeout(countdownTimeout); countdownTimeout = null; }
  const round = getCurrentRound();
  if (!round || round.status !== 'active') return;
  const msLeft = round.countdownEndsAt - Date.now();
  countdownTimeout = setTimeout(() => triggerSpin(io), Math.max(0, msLeft));
}

async function triggerSpin(io) {
  const round = getCurrentRound();
  if (!round || round.status !== 'active') return;

  const spun = spinRound(round.id);
  if (!spun) return;

  io.emit('spin_started');
  broadcastRound(io, spun);

  setTimeout(async () => {
    // Instead of auto-paying, create a pending claim the winner must explicitly redeem.
    // This prevents lost payouts and gives one atomic, one-time claim per round.
    if (spun.winnerWallet && spun.winnerShare > 0) {
      stmts.insertPendingClaim.run({
        round_id: spun.id,
        winner_wallet: spun.winnerWallet,
        amount: spun.winnerShare,
        now: Date.now(),
      });
      console.log(`[claim] Pending claim created for round ${spun.id} — ${spun.winnerWallet} can claim ${spun.winnerShare} lamports`);
    }

    // Queue referral bonuses for losers (30% of their bet)
    if (spun.players && spun.players.length > 0) {
      for (const player of spun.players) {
        if (player.wallet === spun.winnerWallet) continue; // skip winner, handled at claim time
        const referrer = getReferrer(player.wallet);
        if (!referrer) continue;
        const bonusAmount = queueReferralLossBonus(referrer, player.wallet, spun.id, player.betAmount);
        if (bonusAmount && bonusAmount > 0) {
          console.log(`[referral] Queued loss bonus of ${bonusAmount} lamports for ${referrer} (referred ${player.wallet})`);
          io.emit('referral_bonus_queued', { referrerWallet: referrer, referredWallet: player.wallet, bonusAmount, type: 'loss' });
        }
      }
    }

    io.emit('winner_announced', {
      roundId: spun.id,
      winnerWallet: spun.winnerWallet,
      winnerDisplayName: spun.winnerDisplayName,
      winnerShare: spun.winnerShare,
      totalPot: spun.totalPot,
    });

    setTimeout(() => {
      endRound(spun.id);
      io.emit('recent_rounds', getRecentRounds());
      const newRound = getOrCreateActiveRound();
      io.emit('new_round');
      broadcastRound(io, newRound);
    }, 5000);
  }, SPIN_DURATION_MS);
}

function initSocketServer(httpServer) {
  initSolana();

  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    broadcastPlayerCount(io);

    const round = getOrCreateActiveRound();
    socket.emit('round_update', round);
    socket.emit('chat_history', getChatHistory(50));
    socket.emit('recent_rounds', getRecentRounds());
    socket.emit('locked_games', getLockedGames());

    socket.on('get_state', () => {
      const r = getOrCreateActiveRound();
      socket.emit('round_update', r);
      socket.emit('chat_history', getChatHistory(50));
      socket.emit('recent_rounds', getRecentRounds());
      socket.emit('locked_games', getLockedGames());
    });

    socket.on('get_chat_history', () => {
      socket.emit('chat_history', getChatHistory(50));
    });

    socket.on('register_user', ({ wallet, displayName }) => {
      if (!wallet) return;
      upsertUser(wallet, displayName || wallet.slice(0, 8));
    });

    socket.on('check_username', ({ name, wallet }) => {
      const trimmed = (name || '').trim();
      if (!trimmed || trimmed.length < 2) { socket.emit('username_check_result', { available: false, error: 'Too short' }); return; }
      if (trimmed.length > 20) { socket.emit('username_check_result', { available: false, error: 'Too long' }); return; }
      if (!/^[a-zA-Z0-9_\-. ]+$/.test(trimmed)) { socket.emit('username_check_result', { available: false, error: 'Invalid characters' }); return; }
      const taken = isUsernameTaken(trimmed, wallet || null);
      socket.emit('username_check_result', { available: !taken, error: taken ? 'Username already taken' : null });
    });

    socket.on('change_username', ({ wallet, newName }) => {
      if (!wallet) { socket.emit('username_change_result', { success: false, error: 'No wallet' }); return; }
      const result = changeUsername(wallet, newName);
      socket.emit('username_change_result', result);
      if (result.success) {
        io.emit('username_changed', { wallet, newName: result.user.displayName });
      }
    });

    socket.on('get_profile', ({ wallet }) => {
      if (!wallet) return;
      const user = getUser(wallet);
      if (!user) return;
      socket.emit('profile_data', user);
    });

    socket.on('set_avatar', ({ wallet, avatarDataUrl }) => {
      if (!wallet) return;
      const result = setAvatar(wallet, avatarDataUrl);
      if (result?.error) { socket.emit('avatar_result', { success: false, error: result.error }); return; }
      socket.emit('avatar_result', { success: true });
      io.emit('avatar_updated', { wallet, avatar: avatarDataUrl });
    });

    socket.on('place_bet', async ({ wallet, displayName, amountLamports, txSignature, gameType = 'fruitbowl' }) => {
      if (!wallet || !amountLamports) return;

      // Hard reject if no tx signature provided
      if (!txSignature) {
        console.warn('[bet] Rejected bet with no txSignature from', wallet);
        socket.emit('bet_error', { error: 'No transaction signature provided' });
        return;
      }

      // Hard reject if house wallet not configured
      const HOUSE = process.env.NEXT_PUBLIC_HOUSE_WALLET;
      if (!HOUSE) {
        console.error('[bet] NEXT_PUBLIC_HOUSE_WALLET not set — rejecting all bets');
        socket.emit('bet_error', { error: 'Casino not configured correctly' });
        return;
      }

      // Verify on-chain before crediting anything
      const valid = await verifyBetTransaction(txSignature, wallet, HOUSE, amountLamports);
      if (!valid) {
        console.warn('[bet] Rejected unverified bet from', wallet, 'tx:', txSignature);
        socket.emit('bet_error', { error: 'Transaction could not be verified on-chain — your SOL was not added to the pot. If it confirmed, please contact support with your tx signature.' });
        return;
      }

      const result = placeBet(wallet, displayName, amountLamports, gameType);
      if (!result.success) { socket.emit('bet_error', { error: result.error }); return; }
      broadcastRound(io, result.round);
      if (result.round.status === 'active' && result.round.players.length === 2) {
        startCountdown(io);
      }
    });

    socket.on('send_chat', ({ wallet, displayName, message }) => {
      if (!wallet || !message?.trim()) return;
      const msg = addChatMessage(wallet, displayName, message.trim());
      if (msg?.error === 'cooldown') {
        socket.emit('chat_cooldown', { msLeft: msg.msLeft });
        return;
      }
      io.emit('chat_message', msg);
    });

    socket.on('mod_delete_message', ({ wallet, messageId }) => {
      if (!wallet || !messageId) return;
      if (!isModerator(wallet)) {
        socket.emit('mod_error', { error: 'Not authorized' });
        return;
      }
      deleteMessage(messageId);
      io.emit('message_deleted', { messageId });
    });

    socket.on('mod_mute_user', ({ wallet, targetWallet }) => {
      if (!wallet || !targetWallet) return;
      if (!isModerator(wallet)) {
        socket.emit('mod_error', { error: 'Not authorized' });
        return;
      }
      muteUser(targetWallet);
      deleteChatByWallet(targetWallet);
      io.emit('muted_user', { targetWallet });
    });

    socket.on('mod_clear_chat', ({ wallet }) => {
      if (!wallet) return;
      if (!isModerator(wallet)) {
        socket.emit('mod_error', { error: 'Not authorized' });
        return;
      }
      clearAllChat();
      io.emit('chat_cleared');
    });

    socket.on('mod_lock_game', ({ wallet, gameType }) => {
      if (!wallet || !gameType) return;
      if (!isModerator(wallet)) {
        socket.emit('mod_error', { error: 'Not authorized' });
        return;
      }
      lockGame(gameType);
      io.emit('locked_games', getLockedGames());
      console.log(`[mod] ${wallet} locked game: ${gameType}`);
    });

    socket.on('mod_unlock_game', ({ wallet, gameType }) => {
      if (!wallet || !gameType) return;
      if (!isModerator(wallet)) {
        socket.emit('mod_error', { error: 'Not authorized' });
        return;
      }
      unlockGame(gameType);
      io.emit('locked_games', getLockedGames());
      console.log(`[mod] ${wallet} unlocked game: ${gameType}`);
    });

    socket.on('mod_close_game', ({ wallet }) => {
      if (!wallet) return;
      if (!isModerator(wallet)) {
        socket.emit('mod_error', { error: 'Not authorized' });
        return;
      }
      if (countdownTimeout) { clearTimeout(countdownTimeout); countdownTimeout = null; }
      const closed = forceEndCurrentRound();
      if (!closed) {
        socket.emit('mod_error', { error: 'No active round to close' });
        return;
      }
      const newRound = getOrCreateActiveRound();
      io.emit('new_round');
      broadcastRound(io, newRound);
      console.log(`[mod] ${wallet} force-closed round ${closed.id}`);
    });

    // ── Referral handlers ────────────────────────────────────────────────────

    socket.on('register_referral', ({ referredWallet, referrerWallet }) => {
      if (!referredWallet || !referrerWallet) return;
      const result = setReferral(referredWallet, referrerWallet);
      socket.emit('referral_registered', result);
    });

    socket.on('get_referral_stats', ({ wallet }) => {
      if (!wallet) return;
      const stats = getReferralStats(wallet);
      socket.emit('referral_stats', stats);
    });

    socket.on('get_referral_earnings', ({ wallet }) => {
      if (!wallet) return;
      const earnings = getReferralEarnings(wallet);
      socket.emit('referral_earnings', earnings);
    });

    socket.on('get_pending_referral_earnings', ({ wallet }) => {
      if (!wallet) return;
      const pending = getPendingReferralEarnings(wallet);
      const claimed = getClaimedReferralEarnings(wallet);
      const totalUnclaimed = getTotalUnclaimedReferral(wallet);
      const totalClaimed = getTotalClaimedReferral(wallet);
      const paused = isReferralPayoutsPaused();
      socket.emit('pending_referral_earnings', { pending, claimed, totalUnclaimed, totalClaimed, paused });
    });

    socket.on('set_referral_slug', ({ wallet, slug }) => {
      if (!wallet) return;
      const result = setReferralSlug(wallet, slug);
      socket.emit('referral_slug_result', result);
    });

    socket.on('get_referral_slug', ({ wallet }) => {
      if (!wallet) return;
      const slug = getReferralSlug(wallet);
      socket.emit('referral_slug', { slug });
    });

    // ── Claim referral earnings ───────────────────────────────────────────────

    socket.on('claim_referral_earnings', async ({ wallet }) => {
      if (!wallet) {
        socket.emit('referral_claim_result', { success: false, error: 'Invalid request' });
        return;
      }

      try {
        // Check if payouts are paused
        if (isReferralPayoutsPaused()) {
          socket.emit('referral_claim_result', { success: false, error: 'Referral payouts are temporarily paused. Please try again later.' });
          return;
        }

        // Lock all pending earnings atomically
        const locked = lockReferralClaimsForPayout(wallet);
        if (!locked || locked.total <= 0) {
          socket.emit('referral_claim_result', { success: false, error: 'No unclaimed earnings to collect' });
          return;
        }

        console.log(`[referral] Sending ${locked.total} lamports to ${wallet} (${locked.items.length} items)`);
        const payoutTx = await sendPayout(wallet, locked.total);

        if (!payoutTx) {
          // Roll back so they can retry
          rollbackReferralClaims(wallet);
          console.error(`[referral] Payout failed for ${wallet} — rolled back`);
          socket.emit('referral_claim_result', { success: false, error: 'Payout transaction failed — please try again' });
          return;
        }

        // Finalize — stamp real tx hash and record in earnings history
        finalizeReferralClaims(wallet, payoutTx);
        console.log(`[referral] ✓ Paid ${locked.total} lamports to ${wallet} — tx: ${payoutTx}`);

        socket.emit('referral_claim_result', { success: true, claimTx: payoutTx, amount: locked.total, itemCount: locked.items.length });

        // Refresh stats for the referrer
        const stats = getReferralStats(wallet);
        socket.emit('referral_stats', stats);
        const pending = getPendingReferralEarnings(wallet);
        const claimed = getClaimedReferralEarnings(wallet);
        socket.emit('pending_referral_earnings', {
          pending, claimed,
          totalUnclaimed: getTotalUnclaimedReferral(wallet),
          totalClaimed: getTotalClaimedReferral(wallet),
          paused: isReferralPayoutsPaused(),
        });
      } catch (err) {
        console.error('[referral] claim error:', err);
        rollbackReferralClaims(wallet);
        socket.emit('referral_claim_result', { success: false, error: 'Unexpected error — please try again' });
      }
    });

    // ── Mod: toggle referral payouts pause ────────────────────────────────────

    socket.on('mod_toggle_referral_pause', ({ wallet }) => {
      if (!isModerator(wallet)) {
        socket.emit('mod_error', { error: 'Not authorized' });
        return;
      }
      const current = isReferralPayoutsPaused();
      setModSetting('referral_payouts_paused', current ? '0' : '1');
      const newState = !current;
      io.emit('referral_payouts_paused', { paused: newState });
      console.log(`[mod] Referral payouts ${newState ? 'PAUSED' : 'RESUMED'} by ${wallet}`);
      socket.emit('mod_referral_pause_result', { success: true, paused: newState });
    });

    socket.on('mod_get_referral_pause', ({ wallet }) => {
      if (!isModerator(wallet)) return;
      socket.emit('mod_referral_pause_result', { success: true, paused: isReferralPayoutsPaused() });
    });

    // ── Claim payout ──────────────────────────────────────────────────────────

    socket.on('claim_payout', async ({ wallet, roundId }) => {
      // Basic input validation
      if (!wallet || !roundId) {
        socket.emit('claim_result', { success: false, error: 'Invalid request' });
        return;
      }

      // Fetch the pending claim row
      const claim = stmts.getPendingClaim.get(roundId);

      if (!claim) {
        socket.emit('claim_result', { success: false, error: 'No claim found for this round' });
        return;
      }

      // Verify the requesting wallet is actually the winner
      if (claim.winner_wallet !== wallet) {
        socket.emit('claim_result', { success: false, error: 'Not authorized to claim this prize' });
        return;
      }

      // Check if already claimed BEFORE trying to mark — fast path
      if (claim.claimed === 1) {
        socket.emit('claim_result', { success: false, error: 'Prize already claimed', alreadyClaimed: true, claimTx: claim.claim_tx });
        return;
      }

      // ATOMIC LOCK: attempt to mark as claimed in the DB before sending any SOL.
      // The WHERE claimed = 0 condition means only one concurrent request can win this race.
      // SQLite serializes writes, so this is safe even if two claim requests arrive simultaneously.
      const markResult = stmts.markClaimed.run({
        round_id: roundId,
        claim_tx: 'PENDING',
        now: Date.now(),
      });

      if (markResult.changes === 0) {
        // Another request already claimed it between our check and our update
        socket.emit('claim_result', { success: false, error: 'Prize already claimed', alreadyClaimed: true });
        return;
      }

      // We own the claim — now send the SOL
      console.log(`[claim] Sending ${claim.amount} lamports to ${wallet} for round ${roundId}`);
      const payoutTx = await sendPayout(wallet, claim.amount);

      if (!payoutTx) {
        // Payout failed — roll back the claim so they can retry
        stmts.markClaimed.run({ round_id: roundId, claim_tx: null, now: Date.now() });
        // Reset claimed flag so they can try again
        db.prepare('UPDATE pending_claims SET claimed = 0, claim_tx = NULL, claimed_at = NULL WHERE round_id = ?').run(roundId);
        console.error(`[claim] Payout failed for ${wallet} round ${roundId} — claim rolled back`);
        socket.emit('claim_result', { success: false, error: 'Payout transaction failed — please try again' });
        return;
      }

      // Update the DB with the real tx signature
      db.prepare('UPDATE pending_claims SET claim_tx = ? WHERE round_id = ?').run(payoutTx, roundId);

      // Record the win in user stats
      recordWin(wallet, claim.amount);

      // Queue referral win bonus (30% of 5% house tax) — claimable by referrer separately
      const referrerWallet = getReferrer(wallet);
      if (referrerWallet) {
        const bonusAmount = queueReferralWinBonus(referrerWallet, wallet, roundId, claim.amount);
        if (bonusAmount && bonusAmount > 0) {
          console.log(`[referral] Queued win bonus of ${bonusAmount} lamports for ${referrerWallet}`);
          io.emit('referral_bonus_queued', { referrerWallet, referredWallet: wallet, bonusAmount, type: 'win' });
        }
      }

      console.log(`[claim] ✓ Paid ${claim.amount} lamports to ${wallet} — tx: ${payoutTx}`);
      socket.emit('claim_result', { success: true, claimTx: payoutTx, amount: claim.amount });
    });

    // ── Register FruitRoll win (called after client determines winner) ────────
    socket.on('register_fruitroll_win', async ({ wallet, betTxSig, betLamports, fruitCount }) => {
      if (!wallet || !betTxSig || !betLamports || !fruitCount) {
        socket.emit('fruitroll_win_registered', { success: false, error: 'Invalid request' });
        return;
      }

      // Prevent double-registration for same bet tx
      const existing = stmts.getFruitrollClaimByTx.get(betTxSig);
      if (existing) {
        // Already registered — return the existing claim so they can claim it
        socket.emit('fruitroll_win_registered', {
          success: true,
          claimId: existing.id,
          payoutLamports: existing.payout_lamports,
          alreadyRegistered: true,
        });
        return;
      }

      // Verify the bet tx on-chain (confirms SOL reached house wallet)
      const HOUSE = process.env.NEXT_PUBLIC_HOUSE_WALLET;
      if (!HOUSE) {
        socket.emit('fruitroll_win_registered', { success: false, error: 'Casino not configured' });
        return;
      }
      const valid = await verifyBetTransaction(betTxSig, wallet, HOUSE, betLamports);
      if (!valid) {
        socket.emit('fruitroll_win_registered', { success: false, error: 'Bet transaction could not be verified on-chain' });
        return;
      }

      const HOUSE_EDGE = 0.05;
      const payoutLamports = Math.floor(betLamports * fruitCount * (1 - HOUSE_EDGE));
      const claimId = `fr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      stmts.insertFruitrollClaim.run({
        id: claimId,
        winner_wallet: wallet,
        bet_tx_sig: betTxSig,
        bet_lamports: betLamports,
        payout_lamports: payoutLamports,
        fruit_count: fruitCount,
        now: Date.now(),
      });

      console.log(`[fruitroll] Win registered for ${wallet} — claim ${claimId}, payout ${payoutLamports} lamports`);
      socket.emit('fruitroll_win_registered', { success: true, claimId, payoutLamports });
    });

    // ── Claim FruitRoll payout ────────────────────────────────────────────────
    socket.on('claim_fruitroll_payout', async ({ wallet, claimId }) => {
      if (!wallet || !claimId) {
        socket.emit('fruitroll_claim_result', { success: false, error: 'Invalid request' });
        return;
      }

      const claim = stmts.getFruitrollClaimById.get(claimId);
      if (!claim) {
        socket.emit('fruitroll_claim_result', { success: false, error: 'No claim found' });
        return;
      }
      if (claim.winner_wallet !== wallet) {
        socket.emit('fruitroll_claim_result', { success: false, error: 'Not authorized to claim this prize' });
        return;
      }
      if (claim.claimed === 1) {
        socket.emit('fruitroll_claim_result', {
          success: false, error: 'Already claimed', alreadyClaimed: true, claimTx: claim.claim_tx,
        });
        return;
      }

      // Atomic lock — only one request wins this race
      const lockResult = stmts.markFruitrollClaimed.run({ id: claimId, claim_tx: 'PENDING', now: Date.now() });
      if (lockResult.changes === 0) {
        socket.emit('fruitroll_claim_result', { success: false, error: 'Already claimed', alreadyClaimed: true });
        return;
      }

      console.log(`[fruitroll] Sending ${claim.payout_lamports} lamports to ${wallet}`);
      const payoutTx = await sendPayout(wallet, claim.payout_lamports);

      if (!payoutTx) {
        // Roll back so they can retry
        stmts.rollbackFruitrollClaim.run(claimId);
        console.error(`[fruitroll] Payout failed for ${wallet} claim ${claimId} — rolled back`);
        socket.emit('fruitroll_claim_result', { success: false, error: 'Payout transaction failed — please try again' });
        return;
      }

      db.prepare('UPDATE fruitroll_claims SET claim_tx = ? WHERE id = ?').run(payoutTx, claimId);
      recordWin(wallet, claim.payout_lamports);

      // Queue referral win bonus (30% of 5% house tax) — claimable separately
      const referrerWallet = getReferrer(wallet);
      if (referrerWallet) {
        const bonusAmount = queueReferralWinBonus(referrerWallet, wallet, claimId, claim.payout_lamports);
        if (bonusAmount && bonusAmount > 0) {
          console.log(`[referral] Queued FruitRoll win bonus of ${bonusAmount} lamports for ${referrerWallet}`);
          io.emit('referral_bonus_queued', { referrerWallet, referredWallet: wallet, bonusAmount, type: 'win' });
        }
      }

      console.log(`[fruitroll] ✓ Paid ${claim.payout_lamports} lamports to ${wallet} — tx: ${payoutTx}`);
      socket.emit('fruitroll_claim_result', { success: true, claimTx: payoutTx, amount: claim.payout_lamports });
    });

    // ── Get all unclaimed wins for a wallet ────────────────────────────────
    socket.on('get_unclaimed_wins', ({ wallet }) => {
      if (!wallet) return;

      const orangepotUnclaimed = stmts.getUnclaimedOrangepot.all(wallet);
      const fruitrollUnclaimed = stmts.getUnclaimedFruitroll.all(wallet);

      const allUnclaimed = [
        ...orangepotUnclaimed.map(r => ({ ...r, game_type: 'orangepot' })),
        ...fruitrollUnclaimed.map(r => ({ ...r, game_type: 'fruitroll' })),
      ].sort((a, b) => b.created_at - a.created_at);

      const totalLamports = allUnclaimed.reduce((sum, r) => sum + r.amount, 0);

      socket.emit('unclaimed_wins', { items: allUnclaimed, totalLamports });
    });

    // ── Re-enter Orangepot (redirect win back into the pot, no SOL transfer) ─
    socket.on('reenter_orangepot', ({ wallet, roundId }) => {
      if (!wallet || !roundId) {
        socket.emit('reenter_result', { success: false, error: 'Invalid request' });
        return;
      }

      const claim = stmts.getPendingClaim.get(roundId);
      if (!claim) {
        socket.emit('reenter_result', { success: false, error: 'No claim found for this round' });
        return;
      }
      if (claim.winner_wallet !== wallet) {
        socket.emit('reenter_result', { success: false, error: 'Not authorized' });
        return;
      }
      if (claim.claimed === 1) {
        socket.emit('reenter_result', { success: false, error: 'Already claimed or re-entered' });
        return;
      }

      // Atomic lock
      const lockResult = stmts.markClaimed.run({ round_id: roundId, claim_tx: 'REENTER', now: Date.now() });
      if (lockResult.changes === 0) {
        socket.emit('reenter_result', { success: false, error: 'Already claimed or re-entered' });
        return;
      }

      // Place a virtual bet in the current round (no on-chain tx needed)
      const user = stmts.getUser.get(wallet);
      const displayName = user?.display_name || wallet.slice(0, 8);
      const virtualTxSig = `REENTER_${roundId}_${Date.now()}`;

      const result = placeBet(wallet, displayName, claim.amount, 'fruitbowl');
      if (!result.success) {
        // Roll back the claim lock so they can try normal claim
        db.prepare('UPDATE pending_claims SET claimed = 0, claim_tx = NULL, claimed_at = NULL WHERE round_id = ?').run(roundId);
        socket.emit('reenter_result', { success: false, error: result.error || 'Could not enter pot — try claiming instead' });
        return;
      }

      console.log(`[reenter] ${wallet} re-entered ${claim.amount} lamports from round ${roundId} into pot`);
      broadcastRound(io, result.round);
      if (result.round.status === 'active' && result.round.players.length === 2) {
        startCountdown(io);
      }

      socket.emit('reenter_result', { success: true, amountLamports: claim.amount });
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      broadcastPlayerCount(io);
    });
  });

  return io;
}

module.exports = { initSocket: initSocketServer };

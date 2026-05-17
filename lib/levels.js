const LEVELS = [
  { level: 0,   name: 'Seedling',     emoji: '🌱', minSol: 0 },
  { level: 10,  name: 'Cherry',       emoji: '🍒', minSol: 0.5 },
  { level: 20,  name: 'Strawberry',   emoji: '🍓', minSol: 3 },
  { level: 30,  name: 'Orange',       emoji: '🍊', minSol: 7 },
  { level: 40,  name: 'Mango',        emoji: '🥭', minSol: 15 },
  { level: 50,  name: 'Pineapple',    emoji: '🍍', minSol: 30 },
  { level: 60,  name: 'Watermelon',   emoji: '🍉', minSol: 60 },
  { level: 70,  name: 'Dragon Fruit', emoji: '🐉', minSol: 100 },
  { level: 80,  name: 'Coconut',      emoji: '🥥', minSol: 175 },
  { level: 90,  name: 'Durian',       emoji: '👑', minSol: 300 },
  { level: 100, name: 'Golden Bowl',  emoji: '🏆', minSol: 500 },
];

function getLevel(totalBetLamports) {
  const sol = totalBetLamports / 1_000_000_000;
  let current = LEVELS[0];
  for (const tier of LEVELS) {
    if (sol >= tier.minSol) current = tier;
    else break;
  }
  const nextTier = LEVELS.find(t => t.minSol > sol) || null;
  const progress = nextTier
    ? ((sol - current.minSol) / (nextTier.minSol - current.minSol)) * 100
    : 100;
  return {
    ...current,
    nextTier,
    progress: Math.min(100, Math.round(progress)),
    totalSol: sol,
  };
}

module.exports = { getLevel, LEVELS };

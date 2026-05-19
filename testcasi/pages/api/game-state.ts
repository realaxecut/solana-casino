import { NextApiRequest, NextApiResponse } from 'next';
import { getCurrentRound, getOrCreateActiveRound, getMinBetSol, HOUSE_FEE } from '../../lib/gameStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const round = getCurrentRound() || getOrCreateActiveRound();
  res.json({
    round,
    minBetSol: getMinBetSol(),
    houseFee: HOUSE_FEE,
  });
}

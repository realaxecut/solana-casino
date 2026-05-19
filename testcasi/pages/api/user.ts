import { NextApiRequest, NextApiResponse } from 'next';
import { getUser, upsertUser } from '../../lib/gameStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { wallet } = req.query;
    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ error: 'wallet required' });
    }
    const user = getUser(wallet);
    return res.json({ user });
  }

  if (req.method === 'POST') {
    const { wallet, displayName } = req.body;
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    const user = upsertUser(wallet, displayName || wallet.slice(0, 8));
    return res.json({ user });
  }

  res.status(405).end();
}

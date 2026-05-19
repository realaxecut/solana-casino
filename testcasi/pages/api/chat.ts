import { NextApiRequest, NextApiResponse } from 'next';
import { getChatHistory } from '../../lib/gameStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const limit = parseInt((req.query.limit as string) || '50');
  res.json({ messages: getChatHistory(limit) });
}

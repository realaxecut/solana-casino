import { NextApiRequest, NextApiResponse } from 'next';
import { getReferralStats, getReferralEarnings, setReferral, getReferrer, setReferralSlug, getReferralSlug, resolveSlug } from '../../lib/gameStore';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { wallet, type } = req.query;
    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ error: 'wallet required' });
    }
    if (type === 'earnings') return res.json({ earnings: getReferralEarnings(wallet) });
    if (type === 'referrer') return res.json({ referrer: getReferrer(wallet) });
    if (type === 'slug') return res.json({ slug: getReferralSlug(wallet) });
    if (type === 'resolve') return res.json({ wallet: resolveSlug(wallet) });
    return res.json(getReferralStats(wallet));
  }

  if (req.method === 'POST') {
    const { referredWallet, referrerWallet, wallet, slug } = req.body;
    if (wallet && slug !== undefined) return res.json(setReferralSlug(wallet, slug));
    if (!referredWallet || !referrerWallet) return res.status(400).json({ error: 'referredWallet and referrerWallet required' });
    return res.json(setReferral(referredWallet, referrerWallet));
  }

  res.status(405).end();
}

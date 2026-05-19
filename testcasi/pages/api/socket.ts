import { NextApiRequest, NextApiResponse } from 'next';
import { initSocket } from '../../lib/socketServer';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if ((res.socket as any)?.server?.io) {
    res.end();
    return;
  }

  const httpServer = (res.socket as any)?.server;
  if (httpServer) {
    initSocket(httpServer);
    (httpServer as any).io = true;
  }

  res.end();
}

export const config = {
  api: {
    bodyParser: false,
  },
};

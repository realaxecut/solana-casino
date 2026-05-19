require('dotenv').config({ path: '/var/www/solana-casino/.env.local' });
const { createServer } = require('http');
const { initSocket } = require('./lib/socketServer.js');

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end('OK');
});

initSocket(server);

server.listen(3001, '0.0.0.0', () => {
  console.log('> Socket.io backend running on port 3001');
});

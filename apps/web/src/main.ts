import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppViewServer } from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_DB_PATH = path.resolve(__dirname, '../data/opengaming.sqlite');

async function start(): Promise<void> {
  const app = await createAppViewServer({
    dbPath: process.env.DATABASE_PATH ?? DEFAULT_DB_PATH,
  });

  app.server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🕹️  opengaming.games AppView & Viewer running!`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   XRPC:    http://localhost:${PORT}/xrpc/games.opengaming.actor.getProfile?actor=symmetricalboy.com`);
  });

  const shutdown = async () => {
    console.log('\nShutting down opengaming.games AppView...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void start();

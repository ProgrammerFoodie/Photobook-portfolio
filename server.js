import { createApp } from './src/app.js';
import { PORT, HOST, DATA_DIR } from './src/config.js';
import { startScheduler } from './src/icloud.js';

const app = createApp();
const server = app.listen(PORT, HOST, () => {
  console.log(`photolib listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (data: ${DATA_DIR})`);
});
startScheduler();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

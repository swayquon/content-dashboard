import cron from 'node-cron';
import { runSync } from './sync.js';

// Run immediately on startup, then every 6 hours
runSync();
cron.schedule('0 */6 * * *', runSync);

console.log('Cron running — sync scheduled every 6 hours (0:00, 6:00, 12:00, 18:00)');

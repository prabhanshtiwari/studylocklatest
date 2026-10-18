import 'dotenv/config';
import mongoose from 'mongoose';
import { app, sweepExpiredQuizAttempts } from './app.js';

const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

async function start() {
  if (isProduction && (!process.env.MONGODB_URI || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || !process.env.EMAIL_API_KEY || !process.env.EMAIL_FROM || !(process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL))) {
    throw new Error('Production requires MONGODB_URI, JWT_SECRET (at least 32 characters), EMAIL_API_KEY, EMAIL_FROM, and a public application URL.');
  }
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000, maxPoolSize: 10, minPoolSize: 0 });
    console.log('Connected to MongoDB.');
  } else if (isProduction) throw new Error('MONGODB_URI is required in production.');
  const server = app.listen(port, '0.0.0.0', () => console.log(`Study Lock Social listening on ${port}.`));
  const quizSweepTimer = setInterval(() => sweepExpiredQuizAttempts().catch(error => console.error('Quiz finalization sweep failed:', error.message)), 15_000);
  quizSweepTimer.unref();
  const shutdown = async signal => {
    clearInterval(quizSweepTimer);
    console.log(`${signal} received, shutting down.`);
    server.close(async () => { try { await mongoose.disconnect(); } finally { process.exit(0); } });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(error => { console.error('Startup failed:', error.message); process.exit(1); });

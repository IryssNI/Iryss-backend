require('dotenv').config();

const required = ['DATABASE_URL', 'JWT_SECRET'];

const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`[Startup] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const optional = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'OPENAI_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
const missingOptional = optional.filter(key => !process.env[key]);
if (missingOptional.length > 0) {
  console.warn(`[Startup] Optional env vars not set (some features will be unavailable): ${missingOptional.join(', ')}`);
}

const app = require('./app');
const { initCronJobs } = require('./jobs/cronJobs');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`[Server] Iryss backend running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  initCronJobs();
});

process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('[Server] Closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason instanceof Error ? reason.message : reason);
});

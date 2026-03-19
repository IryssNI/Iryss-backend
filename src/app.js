const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const auth = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const dashboardRoutes = require('./routes/dashboard');
const alertRoutes = require('./routes/alerts');
const settingsRoutes = require('./routes/settings');
const webhookRoutes = require('./routes/webhooks');
const messagesRoutes = require('./routes/messages');
const practicesRoutes = require('./routes/practices');
const reviewsRoutes = require('./routes/reviews');

const app = express();

app.use(helmet());

const corsOptions = {
  origin: [
    'https://dazzling-kheer-6c6a8c.netlify.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// Public routes
app.use('/api/auth', authRoutes);
app.use('/webhooks', webhookRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Protected routes
app.use('/api/patients', auth, patientRoutes);
app.use('/api/dashboard', auth, dashboardRoutes);
app.use('/api/alerts', auth, alertRoutes);
app.use('/api/settings', auth, settingsRoutes);
app.use('/api/messages', auth, messagesRoutes);

// Public inbox endpoint for demo dashboard
const db = require('./config/database');
app.get('/api/public/inbox', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT m.id, m.message_body, m.sentiment, m.sent_at, m.direction,
              p.name AS patient_name, p.phone AS patient_phone
       FROM messages m
       JOIN patients p ON p.id = m.patient_id
       ORDER BY m.sent_at DESC
       LIMIT 100`
    );
    res.json({ messages: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public send endpoint (no auth - for dashboard demo)
const twilio_client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
app.post('/api/send-whatsapp', async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });
    const result = await twilio_client.messages.create({
      from: 'whatsapp:' + process.env.TWILIO_PHONE_NUMBER,
      to: 'whatsapp:' + to,
      body: message
    });
    res.json({ success: true, sid: result.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use('/api/practices', auth, practicesRoutes);
app.use('/api/reviews', auth, reviewsRoutes);

// Confirm key routes are registered
console.log('[Routes] POST /api/patients/:id/message — registered');
console.log('[Routes] POST /api/patients/:id/send-checkin — registered');
console.log('[Routes] GET  /api/dashboard/at-risk — registered');
console.log('[Routes] GET  /api/messages/sent-this-week — registered');
console.log('[Routes] PUT  /api/practices/google-review-link — registered');
console.log('[Routes] GET  /api/reviews/stats — registered');

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use(errorHandler);

module.exports = app;

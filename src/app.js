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

const app = express();

app.use(helmet());
app.use(cors({
  origin: [
    'https://dazzling-kheer-6c6a8c.netlify.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors());
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

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use(errorHandler);

module.exports = app;

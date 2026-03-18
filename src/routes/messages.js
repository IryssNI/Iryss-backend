const express = require('express');
const db = require('../config/database');

const router = express.Router();

// GET /api/messages/inbound
router.get('/inbound', async (req, res, next) => {
  try {
    const practiceId = req.practice.id;
    const { page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await db.query(
      `SELECT
         m.id, m.message_body, m.sentiment, m.sent_at,
         p.name AS patient_name,
         pr.name AS practice_name
       FROM messages m
       JOIN patients p ON p.id = m.patient_id
       JOIN practices pr ON pr.id = m.practice_id
       WHERE m.direction = 'inbound'
         AND m.practice_id = $1
       ORDER BY m.sent_at DESC
       LIMIT $2 OFFSET $3`,
      [practiceId, parseInt(limit), offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM messages WHERE direction = 'inbound' AND practice_id = $1`,
      [practiceId]
    );

    res.json({
      messages: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/sent-this-week
router.get('/sent-this-week', async (req, res, next) => {
  try {
    const practiceId = req.practice.id;

    const result = await db.query(
      `SELECT m.id, m.message_body, m.sent_at, m.patient_id,
              p.name AS patient_name
       FROM messages m
       JOIN patients p ON p.id = m.patient_id
       WHERE m.direction = 'outbound'
         AND m.practice_id = $1
         AND m.sent_at > NOW() - INTERVAL '7 days'
       ORDER BY m.sent_at DESC`,
      [practiceId]
    );

    res.json({ messages: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/thread/:patientId
router.get('/thread/:patientId', async (req, res, next) => {
  try {
    const practiceId = req.practice.id;
    const { patientId } = req.params;

    const patientResult = await db.query(
      'SELECT id, name FROM patients WHERE id = $1 AND practice_id = $2',
      [patientId, practiceId]
    );

    if (patientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const messagesResult = await db.query(
      `SELECT id, message_body, direction, sentiment, sent_at
       FROM messages
       WHERE patient_id = $1
       ORDER BY sent_at ASC`,
      [patientId]
    );

    res.json({ patient: patientResult.rows[0], messages: messagesResult.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/unread-count
router.get('/unread-count', async (req, res, next) => {
  try {
    const practiceId = req.practice.id;

    const practiceResult = await db.query(
      'SELECT last_inbox_viewed_at FROM practices WHERE id = $1',
      [practiceId]
    );
    const lastViewed = practiceResult.rows[0]?.last_inbox_viewed_at || null;

    const countResult = await db.query(
      `SELECT COUNT(*) FROM messages
       WHERE practice_id = $1
         AND direction = 'inbound'
         AND ($2::timestamptz IS NULL OR sent_at > $2)`,
      [practiceId, lastViewed]
    );

    res.json({ unread_count: parseInt(countResult.rows[0].count, 10) });
  } catch (err) {
    next(err);
  }
});

// POST /api/messages/mark-read
router.post('/mark-read', async (req, res, next) => {
  try {
    await db.query(
      'UPDATE practices SET last_inbox_viewed_at = NOW() WHERE id = $1',
      [req.practice.id]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});


// POST /api/messages/send
router.post('/send', async (req, res, next) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;

    const twilio = require('twilio')(accountSid, authToken);
    const result = await twilio.messages.create({
      from: `whatsapp:${from}`,
      to: `whatsapp:${to}`,
      body: message
    });

    res.json({ success: true, sid: result.sid });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

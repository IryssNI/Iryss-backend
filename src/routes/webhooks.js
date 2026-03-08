const express = require('express');
const twilio = require('twilio');
const db = require('../config/database');
const { analyseReply } = require('../services/openaiService');
const { sendUrgentAlert } = require('../services/emailService');

const router = express.Router();

// POST /webhooks/twilio/inbound
// Twilio sends application/x-www-form-urlencoded
router.post('/twilio/inbound', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    // Validate Twilio signature in production
    if (process.env.NODE_ENV === 'production') {
      const signature = req.headers['x-twilio-signature'];
      const url = `${process.env.APP_URL}/webhooks/twilio/inbound`;
      const valid = twilio.validateRequest(
        process.env.TWILIO_AUTH_TOKEN,
        signature,
        url,
        req.body
      );
      if (!valid) {
        return res.status(403).send('<Response></Response>');
      }
    }

    const fromPhone = (req.body.From || '').replace(/^whatsapp:/, '');
    const messageText = req.body.Body;

    if (!fromPhone || !messageText) {
      return res.type('text/xml').send('<Response></Response>');
    }

    // Find patient(s) by phone number
    const patientResult = await db.query(
      `SELECT p.id, p.practice_id, p.name
       FROM patients p
       WHERE p.phone = $1`,
      [fromPhone]
    );

    if (patientResult.rows.length === 0) {
      return res.type('text/xml').send('<Response></Response>');
    }

    for (const patient of patientResult.rows) {
      // Save inbound message (no PII in log)
      const msgResult = await db.query(
        `INSERT INTO messages (patient_id, practice_id, message_body, direction, sent_at)
         VALUES ($1, $2, $3, 'inbound', NOW())
         RETURNING id`,
        [patient.id, patient.practice_id, messageText]
      );

      // Analyse sentiment
      let sentiment = null;
      let summary = null;

      try {
        const analysis = await analyseReply(messageText);
        sentiment = analysis.sentiment;
        summary = analysis.summary;
      } catch {
        // Sentiment analysis failed — continue without it
      }

      // Update message with sentiment
      if (sentiment) {
        await db.query(
          'UPDATE messages SET sentiment = $1 WHERE id = $2',
          [sentiment, msgResult.rows[0].id]
        );
      }

      // If positive reply, lower risk status to encourage re-engagement tracking
      if (sentiment === 'positive') {
        await db.query(
          `UPDATE patients SET risk_status = 'low', risk_score = GREATEST(0, risk_score - 30), updated_at = NOW()
           WHERE id = $1`,
          [patient.id]
        );
      }

      // If urgent, create alert and email practice
      if (sentiment === 'urgent') {
        await db.query(
          `INSERT INTO alerts (patient_id, practice_id, alert_type)
           VALUES ($1, $2, 'urgent_reply')`,
          [patient.id, patient.practice_id]
        );

        const practiceResult = await db.query(
          'SELECT id, name, email FROM practices WHERE id = $1',
          [patient.practice_id]
        );

        if (practiceResult.rows.length > 0) {
          try {
            await sendUrgentAlert(practiceResult.rows[0], patient.name, summary || 'Urgent message received');
          } catch {
            // Email failed — alert is still saved in DB
          }
        }
      }
    }

    // Respond to Twilio (empty TwiML — no auto-reply)
    res.type('text/xml').send('<Response></Response>');
  } catch {
    res.type('text/xml').send('<Response></Response>');
  }
});

module.exports = router;

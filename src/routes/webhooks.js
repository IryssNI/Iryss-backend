const express = require('express');
const twilio = require('twilio');
const db = require('../config/database');
const { analyseReply, generateReply } = require('../services/openaiService');
const { sendUrgentAlert } = require('../services/emailService');

const router = express.Router();

// POST /webhooks/twilio/inbound
router.post('/twilio/inbound', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    // Validate Twilio signature when explicitly enabled
    if (process.env.TWILIO_VALIDATE_SIGNATURE === 'true') {
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
    const messageText = (req.body.Body || '').trim();

    if (!fromPhone || !messageText) {
      return res.type('text/xml').send('<Response></Response>');
    }

    // Find patient by phone number
    const patientResult = await db.query(
      `SELECT p.id, p.practice_id, p.name
       FROM patients p
       WHERE p.phone = $1
       LIMIT 1`,
      [fromPhone]
    );

    if (patientResult.rows.length === 0) {
      return res.type('text/xml').send('<Response></Response>');
    }

    const patient = patientResult.rows[0];

    // Load practice details
    const practiceResult = await db.query(
      'SELECT id, name, email FROM practices WHERE id = $1',
      [patient.practice_id]
    );
    const practice = practiceResult.rows[0];

    // Load last 10 messages for conversation history (oldest first)
    const historyResult = await db.query(
      `SELECT message_body, direction FROM messages
       WHERE patient_id = $1
       ORDER BY sent_at DESC
       LIMIT 10`,
      [patient.id]
    );
    const conversationHistory = historyResult.rows
      .reverse()
      .map(m => ({
        role: m.direction === 'outbound' ? 'assistant' : 'user',
        content: m.message_body,
      }));

    // Save inbound message
    const inboundMsg = await db.query(
      `INSERT INTO messages (patient_id, practice_id, message_body, direction, sent_at)
       VALUES ($1, $2, $3, 'inbound', NOW())
       RETURNING id`,
      [patient.id, patient.practice_id, messageText]
    );

    // Run sentiment analysis and AI reply generation in parallel
    let sentiment = null;
    let summary = null;
    let aiReply = null;

    const [sentimentResult, replyResult] = await Promise.allSettled([
      analyseReply(messageText),
      generateReply(practice.name, conversationHistory, messageText),
    ]);

    if (sentimentResult.status === 'fulfilled') {
      sentiment = sentimentResult.value.sentiment;
      summary = sentimentResult.value.summary;
    }

    if (replyResult.status === 'fulfilled') {
      aiReply = replyResult.value;
    }

    // Update inbound message with sentiment
    if (sentiment) {
      await db.query(
        'UPDATE messages SET sentiment = $1 WHERE id = $2',
        [sentiment, inboundMsg.rows[0].id]
      );
    }

    // Update patient risk on positive reply
    if (sentiment === 'positive') {
      await db.query(
        `UPDATE patients
         SET risk_status = 'low', risk_score = GREATEST(0, risk_score - 30), updated_at = NOW()
         WHERE id = $1`,
        [patient.id]
      );
    }

    // Create alert and email practice on urgent reply
    if (sentiment === 'urgent') {
      await db.query(
        `INSERT INTO alerts (patient_id, practice_id, alert_type)
         VALUES ($1, $2, 'urgent_reply')`,
        [patient.id, patient.practice_id]
      );

      try {
        await sendUrgentAlert(practice, patient.name, summary || 'Urgent message received');
      } catch {
        // Email failure does not block the response
      }
    }

    // Send AI reply via Twilio WhatsApp and save to messages table
    if (aiReply) {
      const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: `whatsapp:${fromPhone}`,
        body: aiReply,
      });

      await db.query(
        `INSERT INTO messages (patient_id, practice_id, message_body, direction, sent_at)
         VALUES ($1, $2, $3, 'outbound', NOW())`,
        [patient.id, patient.practice_id, aiReply]
      );
    }

    res.type('text/xml').send('<Response></Response>');
  } catch {
    res.type('text/xml').send('<Response></Response>');
  }
});

module.exports = router;

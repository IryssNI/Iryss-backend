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

    // Load full patient record
    const patientResult = await db.query(
      `SELECT id, practice_id, name, phone, patient_type,
              last_reorder_date, last_appointment_date, days_since_reorder,
              risk_status, risk_score
       FROM patients
       WHERE phone = $1
       LIMIT 1`,
      [fromPhone]
    );

    if (patientResult.rows.length === 0) {
      return res.type('text/xml').send('<Response></Response>');
    }

    const patient = patientResult.rows[0];

    // Load practice details
    const practiceResult = await db.query(
      'SELECT id, name, email, sms_sender_name FROM practices WHERE id = $1',
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
    const [sentimentResult, replyResult] = await Promise.allSettled([
      analyseReply(messageText),
      generateReply(practice, patient, conversationHistory, messageText),
    ]);

    // Handle sentiment
    let sentiment = null;
    let summary = null;
    if (sentimentResult.status === 'fulfilled') {
      sentiment = sentimentResult.value.sentiment;
      summary = sentimentResult.value.summary;
    }

    // Handle AI reply
    let aiReply = null;
    let bookAppointment = null;
    let saveFeedback = null;
    if (replyResult.status === 'fulfilled') {
      aiReply = replyResult.value.reply;
      bookAppointment = replyResult.value.book_appointment;
      saveFeedback = replyResult.value.save_feedback;
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

    // Save appointment if AI confirmed a booking
    if (bookAppointment && bookAppointment.date && bookAppointment.time) {
      await db.query(
        `INSERT INTO appointments (patient_id, practice_id, proposed_date, proposed_time, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [patient.id, patient.practice_id, bookAppointment.date, bookAppointment.time]
      );
    }

    // Save feedback if AI gathered meaningful feedback
    if (saveFeedback) {
      await db.query(
        `INSERT INTO feedback (patient_id, practice_id, feedback_text, sentiment)
         VALUES ($1, $2, $3, $4)`,
        [patient.id, patient.practice_id, saveFeedback, sentiment]
      );
    }

    // Send AI reply via Twilio WhatsApp and log as outbound message
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

const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse');
const db = require('../config/database');
const twilio = require('twilio');
const { sendPatientSMS, buildLowRiskCheckinMessage } = require('../services/smsService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

function parseDate(val) {
  if (!val || val.trim() === '') return null;
  const d = new Date(val.trim());
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function computeDaysSince(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// POST /api/patients/import
router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    const rows = await new Promise((resolve, reject) => {
      parse(req.file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }, (err, records) => {
        if (err) reject(err);
        else resolve(records);
      });
    });

    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    const practiceId = req.practice.id;
    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const name = row.name || row.Name;
      const phone = row.phone || row.Phone;
      const lastReorderDate = parseDate(row.last_reorder_date || row['Last Reorder Date']);
      const lastAppointmentDate = parseDate(row.last_appointment_date || row['Last Appointment Date']);
      const patientType = (row.patient_type || row['Patient Type'] || 'general').toLowerCase();

      if (!name) {
        skipped++;
        continue;
      }

      const daysSinceReorder = computeDaysSince(lastReorderDate);

      await db.query(
        `INSERT INTO patients
           (practice_id, name, phone, last_reorder_date, last_appointment_date, days_since_reorder, patient_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [practiceId, name, phone || null, lastReorderDate, lastAppointmentDate, daysSinceReorder, patientType]
      );

      imported++;
    }

    res.json({ imported, skipped, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/patients
router.get('/', async (req, res, next) => {
  try {
    const { risk_status, page = 1, limit = 50 } = req.query;
    const practiceId = req.practice.id;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT id, name, phone, last_reorder_date, last_appointment_date,
             days_since_reorder, risk_score, risk_status, patient_type, updated_at
      FROM patients
      WHERE practice_id = $1
    `;
    const params = [practiceId];

    if (risk_status) {
      params.push(risk_status);
      query += ` AND risk_status = $${params.length}`;
    }

    query += ` ORDER BY risk_score DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), offset);

    const result = await db.query(query, params);

    const countResult = await db.query(
      `SELECT COUNT(*) FROM patients WHERE practice_id = $1${risk_status ? ' AND risk_status = $2' : ''}`,
      risk_status ? [practiceId, risk_status] : [practiceId]
    );

    res.json({
      patients: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/patients/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const practiceId = req.practice.id;

    const patientResult = await db.query(
      `SELECT id, name, phone, last_reorder_date, last_appointment_date,
              days_since_reorder, risk_score, risk_status, patient_type, created_at, updated_at
       FROM patients WHERE id = $1 AND practice_id = $2`,
      [id, practiceId]
    );

    if (patientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const messagesResult = await db.query(
      `SELECT id, message_body, direction, sentiment, sent_at
       FROM messages WHERE patient_id = $1 ORDER BY sent_at DESC LIMIT 20`,
      [id]
    );

    res.json({
      patient: patientResult.rows[0],
      messages: messagesResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/patients/:id/message — manually trigger an SMS to a patient
router.post('/:id/message', async (req, res, next) => {
  try {
    const { id } = req.params;
    const practiceId = req.practice.id;

    const patientResult = await db.query(
      'SELECT id, name, phone, patient_type, risk_status FROM patients WHERE id = $1 AND practice_id = $2',
      [id, practiceId]
    );

    if (patientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const patient = patientResult.rows[0];

    if (!patient.phone) {
      return res.status(400).json({ error: 'Patient has no phone number on record' });
    }

    const practiceResult = await db.query(
      'SELECT id, name, sms_sender_name FROM practices WHERE id = $1',
      [practiceId]
    );

    await sendPatientSMS(patient, practiceResult.rows[0]);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/patients/:id/send-checkin — manually send a low-risk check-in message
router.post('/:id/send-checkin', async (req, res) => {
  const { id } = req.params;
  const practiceId = req.practice.id;
  console.log(`[send-checkin] Hit for patient ${id}, practice ${practiceId}`);

  // 1. Load patient and practice
  let patient, practice;
  try {
    const patientResult = await db.query(
      'SELECT id, name, phone, patient_type FROM patients WHERE id = $1 AND practice_id = $2',
      [id, practiceId]
    );

    if (patientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    patient = patientResult.rows[0];

    if (!patient.phone) {
      return res.status(400).json({ error: 'Patient has no phone number on record' });
    }

    const practiceResult = await db.query(
      'SELECT id, name, sms_sender_name FROM practices WHERE id = $1',
      [practiceId]
    );
    practice = practiceResult.rows[0];
  } catch (err) {
    console.error(`[send-checkin] DB lookup failed for patient ${id}:`, err.message);
    return res.status(500).json({ error: 'Failed to load patient data' });
  }

  // 2. Build message body
  const messageBody = buildLowRiskCheckinMessage(patient, practice.sms_sender_name || practice.name);

  // 3. Send via Twilio — if this fails, return 500 (message not sent)
  try {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      body: messageBody,
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      to: `whatsapp:${patient.phone}`,
    });
    console.log(`[send-checkin] WhatsApp sent successfully to patient ${id} (${patient.name})`);
  } catch (err) {
    console.error(`[send-checkin] Twilio send failed for patient ${id}:`, err.message);
    return res.status(500).json({ error: 'Failed to send WhatsApp message' });
  }

  // 4. Log to messages table — best effort, WhatsApp already sent so don't block the 200
  try {
    await db.query(
      `INSERT INTO messages (patient_id, practice_id, message_body, direction, message_type, sent_at)
       VALUES ($1, $2, $3, 'outbound', 'manual_checkin', NOW())`,
      [patient.id, practice.id, messageBody]
    );
  } catch (err) {
    console.error(`[send-checkin] DB log failed for patient ${id} (WhatsApp already sent):`, err.message);
  }

  return res.status(200).json({ success: true, message: 'Check-in sent' });
});

module.exports = router;

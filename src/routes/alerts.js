const express = require('express');
const db = require('../config/database');

const router = express.Router();

// GET /api/alerts
router.get('/', async (req, res, next) => {
  try {
    const practiceId = req.practice.id;

    const result = await db.query(
      `SELECT
         a.id, a.alert_type, a.resolved, a.created_at,
         p.id AS patient_id, p.name AS patient_name,
         m.message_body AS trigger_message, m.sent_at AS message_at
       FROM alerts a
       INNER JOIN patients p ON p.id = a.patient_id
       LEFT JOIN LATERAL (
         SELECT message_body, sent_at
         FROM messages
         WHERE patient_id = a.patient_id AND direction = 'inbound'
         ORDER BY sent_at DESC
         LIMIT 1
       ) m ON true
       WHERE a.practice_id = $1 AND a.resolved = false
       ORDER BY a.created_at DESC`,
      [practiceId]
    );

    res.json({ alerts: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/alerts/:id/resolve
router.post('/:id/resolve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const practiceId = req.practice.id;

    const result = await db.query(
      `UPDATE alerts SET resolved = true
       WHERE id = $1 AND practice_id = $2
       RETURNING id, resolved`,
      [id, practiceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ alert: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

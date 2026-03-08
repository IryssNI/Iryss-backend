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

module.exports = router;

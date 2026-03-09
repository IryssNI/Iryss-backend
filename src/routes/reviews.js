const express = require('express');
const db = require('../config/database');

const router = express.Router();

// GET /api/reviews/stats
router.get('/stats', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE message_type = 'review_request'  AND sent_at >= date_trunc('month', NOW())) AS review_requests_sent_this_month,
         COUNT(*) FILTER (WHERE message_type = 'review_followup' AND sent_at >= date_trunc('month', NOW())) AS followups_sent
       FROM messages
       WHERE practice_id = $1
         AND direction = 'outbound'`,
      [req.practice.id]
    );

    const row = result.rows[0];
    res.json({
      review_requests_sent_this_month: parseInt(row.review_requests_sent_this_month, 10),
      followups_sent: parseInt(row.followups_sent, 10),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

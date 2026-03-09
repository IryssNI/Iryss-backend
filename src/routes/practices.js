const express = require('express');
const db = require('../config/database');

const router = express.Router();

// PUT /api/practices/google-review-link
router.put('/google-review-link', async (req, res, next) => {
  try {
    const { google_review_link } = req.body;

    if (google_review_link === undefined) {
      return res.status(400).json({ error: 'google_review_link is required' });
    }

    await db.query(
      'UPDATE practices SET google_review_link = $1 WHERE id = $2',
      [google_review_link || null, req.practice.id]
    );

    res.json({ google_review_link: google_review_link || null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

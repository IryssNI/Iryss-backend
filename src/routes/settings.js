const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../config/database');

const router = express.Router();

// GET /api/settings
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, email, pms_type, sms_sender_name, digest_email_time, created_at
       FROM practices WHERE id = $1`,
      [req.practice.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Practice not found' });
    }

    res.json({ settings: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings
router.put('/', async (req, res, next) => {
  try {
    const { name, email, sms_sender_name, digest_email_time, current_password, new_password } = req.body;
    const practiceId = req.practice.id;

    const practiceResult = await db.query(
      'SELECT id, password_hash FROM practices WHERE id = $1',
      [practiceId]
    );

    if (practiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Practice not found' });
    }

    const fields = [];
    const values = [];

    if (name) {
      fields.push(`name = $${fields.length + 1}`);
      values.push(name);
    }

    if (email) {
      const exists = await db.query(
        'SELECT id FROM practices WHERE email = $1 AND id != $2',
        [email.toLowerCase(), practiceId]
      );
      if (exists.rows.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      fields.push(`email = $${fields.length + 1}`);
      values.push(email.toLowerCase());
    }

    if (sms_sender_name !== undefined) {
      fields.push(`sms_sender_name = $${fields.length + 1}`);
      values.push(sms_sender_name);
    }

    if (digest_email_time !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(digest_email_time)) {
        return res.status(400).json({ error: 'digest_email_time must be in HH:MM format' });
      }
      fields.push(`digest_email_time = $${fields.length + 1}`);
      values.push(digest_email_time);
    }

    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ error: 'current_password is required to set a new password' });
      }
      const valid = await bcrypt.compare(current_password, practiceResult.rows[0].password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      if (new_password.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      const hash = await bcrypt.hash(new_password, 12);
      fields.push(`password_hash = $${fields.length + 1}`);
      values.push(hash);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(practiceId);
    const result = await db.query(
      `UPDATE practices SET ${fields.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, name, email, pms_type, sms_sender_name, digest_email_time`,
      values
    );

    res.json({ settings: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

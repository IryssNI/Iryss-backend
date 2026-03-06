const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const router = express.Router();
const SALT_ROUNDS = 12;

// POST /api/auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { name, email, password, pms_type } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await db.query('SELECT id FROM practices WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await db.query(
      `INSERT INTO practices (name, email, password_hash, pms_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, pms_type, created_at`,
      [name, email.toLowerCase(), password_hash, pms_type || null]
    );

    const practice = result.rows[0];
    const token = jwt.sign(
      { id: practice.id, email: practice.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, practice });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await db.query(
      'SELECT id, name, email, password_hash, pms_type FROM practices WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const practice = result.rows[0];
    const valid = await bcrypt.compare(password, practice.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: practice.id, email: practice.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password_hash, ...practiceData } = practice;

    res.json({ token, practice: practiceData });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

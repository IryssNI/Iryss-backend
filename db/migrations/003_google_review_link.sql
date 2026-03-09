-- Migration 003: add google_review_link to practices

ALTER TABLE practices ADD COLUMN IF NOT EXISTS google_review_link TEXT;

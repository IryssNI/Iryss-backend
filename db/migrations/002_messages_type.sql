-- Migration 002: add message_type column to messages table

ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_messages_message_type ON messages(message_type);

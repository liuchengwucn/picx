-- Add CHECK constraint to ensure credits cannot be negative
-- This prevents race conditions from causing negative credit balances
ALTER TABLE "users" ADD CONSTRAINT "users_credits_check" CHECK ("credits" >= 0);

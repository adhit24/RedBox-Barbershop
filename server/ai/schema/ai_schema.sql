-- =============================================
-- AI GROOMING ASSISTANT DATABASE SCHEMA
-- =============================================

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. AI Uploads Table
CREATE TABLE IF NOT EXISTS ai_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlet_id UUID REFERENCES outlets(id),
  
  -- Image storage
  original_image_url TEXT NOT NULL,
  processed_image_url TEXT,
  
  -- Service configuration
  service_type VARCHAR(50) NOT NULL CHECK (service_type IN (
    'face_analysis', 
    'hairstyle', 
    'outfit', 
    'preview'
  )),
  
  -- Processing status
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'processing', 
    'completed',
    'failed'
  )),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processing_started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0
);

-- Index untuk query performance
CREATE INDEX idx_ai_uploads_user_id ON ai_uploads(user_id);
CREATE INDEX idx_ai_uploads_status ON ai_uploads(status);
CREATE INDEX idx_ai_uploads_created_at ON ai_uploads(created_at DESC);

-- 3. AI Results Table
CREATE TABLE IF NOT EXISTS ai_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES ai_uploads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- AI Analysis Results (JSONB untuk fleksibilitas)
  analysis_result JSONB,
  
  -- Structured recommendations
  recommendations JSONB DEFAULT '[]'::jsonb,
  
  -- Generated images (array of URLs)
  generated_images TEXT[] DEFAULT '{}',
  
  -- Raw AI response untuk debugging
  raw_ai_response TEXT,
  
  -- Metadata
  model_used VARCHAR(50),
  tokens_used INTEGER,
  processing_time_ms INTEGER,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ai_results_upload_id ON ai_results(upload_id);
CREATE INDEX idx_ai_results_user_id ON ai_results(user_id);

-- 4. AI Usage Logs (Tracking & Rate Limiting)
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  service_type VARCHAR(50) NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 1,
  
  -- Status tracking
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  
  -- Metadata
  ip_address INET,
  user_agent TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_logs_user_id ON ai_usage_logs(user_id);
CREATE INDEX idx_ai_usage_logs_created_at ON ai_usage_logs(created_at DESC);

-- 5. AI Credits Management (Add columns to existing users table)
-- Note: Run this as ALTER TABLE if users table exists

-- Check if columns exist before adding
DO $$
BEGIN
  -- Add ai_credits column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'ai_credits') THEN
    ALTER TABLE users ADD COLUMN ai_credits INTEGER DEFAULT 0;
  END IF;
  
  -- Add ai_subscription_tier column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'ai_subscription_tier') THEN
    ALTER TABLE users ADD COLUMN ai_subscription_tier VARCHAR(20) 
      CHECK (ai_subscription_tier IN ('basic', 'pro', 'ultra'));
  END IF;
  
  -- Add ai_subscription_expires column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'ai_subscription_expires') THEN
    ALTER TABLE users ADD COLUMN ai_subscription_expires TIMESTAMP WITH TIME ZONE;
  END IF;
  
  -- Add total_ai_usage column untuk tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'total_ai_usage') THEN
    ALTER TABLE users ADD COLUMN total_ai_usage INTEGER DEFAULT 0;
  END IF;
END $$;

-- 6. Functions & Triggers

-- Function: Decrement AI credits
CREATE OR REPLACE FUNCTION decrement_ai_credits(user_uuid UUID, amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
  new_credits INTEGER;
BEGIN
  UPDATE users 
  SET ai_credits = ai_credits - amount,
      total_ai_usage = total_ai_usage + amount
  WHERE id = user_uuid
    AND ai_credits >= amount
  RETURNING ai_credits INTO new_credits;
  
  RETURN new_credits;
END;
$$ LANGUAGE plpgsql;

-- Function: Increment AI credits
CREATE OR REPLACE FUNCTION increment_ai_credits(user_uuid UUID, amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
  new_credits INTEGER;
BEGIN
  UPDATE users 
  SET ai_credits = ai_credits + amount
  WHERE id = user_uuid
  RETURNING ai_credits INTO new_credits;
  
  RETURN new_credits;
END;
$$ LANGUAGE plpgsql;

-- Function: Get user AI stats
CREATE OR REPLACE FUNCTION get_user_ai_stats(user_uuid UUID)
RETURNS TABLE (
  total_uploads BIGINT,
  completed_analysis BIGINT,
  failed_analysis BIGINT,
  total_credits_used BIGINT,
  current_credits INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM ai_uploads WHERE user_id = user_uuid) as total_uploads,
    (SELECT COUNT(*) FROM ai_uploads WHERE user_id = user_uuid AND status = 'completed') as completed_analysis,
    (SELECT COUNT(*) FROM ai_uploads WHERE user_id = user_uuid AND status = 'failed') as failed_analysis,
    (SELECT COALESCE(SUM(credits_used), 0) FROM ai_usage_logs WHERE user_id = user_uuid) as total_credits_used,
    (SELECT ai_credits FROM users WHERE id = user_uuid) as current_credits;
END;
$$ LANGUAGE plpgsql;

-- 7. RLS Policies (Row Level Security)

-- Enable RLS on AI tables
ALTER TABLE ai_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- Policies untuk ai_uploads
CREATE POLICY "Users can view own uploads" ON ai_uploads
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create own uploads" ON ai_uploads
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Policies untuk ai_results
CREATE POLICY "Users can view own results" ON ai_results
  FOR SELECT USING (user_id = auth.uid());

-- Policies untuk ai_usage_logs (read-only untuk users)
CREATE POLICY "Users can view own usage logs" ON ai_usage_logs
  FOR SELECT USING (user_id = auth.uid());

-- =============================================
-- END OF AI SCHEMA
-- =============================================

-- TruthLens AI — Supabase PostgreSQL Initial Schema & Row Level Security (RLS)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. User Profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Datasets Registry
CREATE TABLE IF NOT EXISTS public.datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  dataset_format TEXT NOT NULL DEFAULT 'custom',
  file_reference TEXT NOT NULL,
  column_mapping JSONB,
  record_count INTEGER NOT NULL DEFAULT 0,
  fake_count INTEGER NOT NULL DEFAULT 0,
  real_count INTEGER NOT NULL DEFAULT 0,
  duplicates_removed INTEGER NOT NULL DEFAULT 0,
  missing_removed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'validated',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Trained ML Model Versions
CREATE TABLE IF NOT EXISTS public.model_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  version TEXT NOT NULL,
  dataset_id UUID NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  accuracy DOUBLE PRECISION NOT NULL DEFAULT 0,
  precision DOUBLE PRECISION NOT NULL DEFAULT 0,
  recall DOUBLE PRECISION NOT NULL DEFAULT 0,
  f1_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  roc_auc DOUBLE PRECISION NOT NULL DEFAULT 0,
  confusion_matrix JSONB,
  cv_scores JSONB,
  artifact_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'trained' CHECK (status IN ('trained', 'active', 'archived', 'failed')),
  trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Analyses History
CREATE TABLE IF NOT EXISTS public.analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  input_mode TEXT NOT NULL DEFAULT 'article',
  headline TEXT,
  article_text TEXT NOT NULL,
  source_url TEXT,
  prediction TEXT NOT NULL CHECK (prediction IN ('REAL', 'FAKE', 'UNCERTAIN')),
  confidence DOUBLE PRECISION NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  explanation JSONB NOT NULL,
  source_credibility JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. User Feedback (stored separately from training datasets)
CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comments TEXT,
  reference_url TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'reviewed', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Independent Verification Sources
CREATE TABLE IF NOT EXISTS public.verification_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  claim_text TEXT,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  finding TEXT NOT NULL,
  stance TEXT DEFAULT 'context',
  publication_date TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_analyses_user_created ON public.analyses(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_prediction ON public.analyses(prediction);
CREATE INDEX IF NOT EXISTS idx_model_versions_status ON public.model_versions(status);
CREATE INDEX IF NOT EXISTS idx_feedback_analysis ON public.feedback(analysis_id);

-- Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_sources ENABLE ROW LEVEL SECURITY;

-- Profiles: users read/update own profile; admins read all
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Analyses: users strictly read/insert/delete only their own records
CREATE POLICY "Users manage own analyses" ON public.analyses
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Feedback: users insert/view own feedback
CREATE POLICY "Users manage own feedback" ON public.feedback
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Verification sources: readable by analysis owner
CREATE POLICY "Users read own verification sources" ON public.verification_sources
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.analyses a
      WHERE a.id = verification_sources.analysis_id AND a.user_id = auth.uid()
    )
  );

-- Models: authenticated users can inspect active model metadata; admin writes via service role
CREATE POLICY "Authenticated read active models" ON public.model_versions
  FOR SELECT TO authenticated USING (status IN ('active', 'trained'));

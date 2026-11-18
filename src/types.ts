export interface User {
  id: string;
  full_name: string;
  email: string;
  role: 'user' | 'admin';
  created_at: string;
}

export interface FeatureContribution {
  term: string;
  weight: number;
  tfidf: number;
  contribution: number;
  direction: 'fake' | 'real';
}

export interface MlPredictionResult {
  prediction: 'REAL' | 'FAKE' | 'UNCERTAIN';
  raw_label: 'REAL' | 'FAKE';
  confidence: number;
  prob_fake: number;
  prob_real: number;
  uncertainty_threshold: number;
  model_name: string;
  model_version: string;
  algorithm: 'tfidf_logreg' | 'tfidf_nb' | 'tfidf_svm';
  matched_features_count: number;
  total_tokens: number;
  vocabulary_coverage?: number;
  top_fake_features: FeatureContribution[];
  top_real_features: FeatureContribution[];
  all_matched_terms: Array<{ term: string; direction: 'fake' | 'real'; contribution: number }>;
  explanation_summary: string;
  limitations: string[];
  decision_debug?: {
    prob_real_raw: number;
    prob_fake_raw: number;
    compared_probability_raw: number;
    threshold_raw: number;
    rule_applied: string;
  };
}

export interface SourceCredibilityReport {
  domain: string | null;
  publisher_name: string | null;
  uses_https: boolean | null;
  author_detected: string | null;
  publication_date: string | null;
  transparency_signals: string[];
  known_profile: {
    status: 'verified_news_organization' | 'fact_checking_body' | 'satire_or_parody' | 'unrated_domain';
    summary: string;
    editorial_standards: string;
  };
  disclaimer: string;
}

export interface VerificationReference {
  claim_text: string;
  source_name: string;
  source_url: string;
  finding: string;
  stance: 'supporting' | 'contradicting' | 'context';
  publication_date: string | null;
}

export interface FactCheckResult {
  available: boolean;
  reason: string | null;
  extracted_claims: string[];
  references: VerificationReference[];
}

export interface AnalysisResponse {
  id: string;
  created_at: string;
  input_mode: 'headline' | 'article' | 'url';
  headline: string;
  article_text: string;
  source_url: string | null;
  extracted_meta?: {
    author?: string | null;
    published_date?: string | null;
    site_name?: string | null;
    word_count?: number;
  } | null;
  ml_result: MlPredictionResult;
  source_credibility: SourceCredibilityReport | null;
  fact_check?: FactCheckResult;
  verification_sources?: VerificationReference[];
}

export interface HistoryItem {
  id: string;
  input_mode: 'headline' | 'article' | 'url';
  headline: string;
  source_url: string | null;
  prediction: 'REAL' | 'FAKE' | 'UNCERTAIN';
  confidence: number;
  model_name: string;
  model_version: string;
  created_at: string;
}

export interface ModelVersionRecord {
  id: string;
  model_name: string;
  algorithm: string;
  version: string;
  dataset_id: string;
  dataset_name?: string;
  dataset_size?: number;
  accuracy: number;
  precision_score: number;
  recall_score: number;
  f1_score: number;
  roc_auc: number;
  confusion_matrix: [[number, number], [number, number]] | null;
  cv_scores: {
    cv_accuracy_mean: number;
    cv_f1_mean: number;
    brier_score?: number;
    per_class?: {
      real: { precision: number; recall: number; f1: number; support: number };
      fake: { precision: number; recall: number; f1: number; support: number };
    };
    train_size: number;
    test_size: number;
  } | null;
  status: 'trained' | 'active' | 'archived' | 'failed';
  trained_at: string;
}

export interface DatasetRecord {
  id: string;
  name: string;
  dataset_format: string;
  file_reference: string;
  record_count: number;
  fake_count: number;
  real_count: number;
  duplicates_removed: number;
  missing_removed: number;
  status: string;
  uploaded_at: string;
}

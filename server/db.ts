import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ensureSeedDatasetCsv } from './data/seedDataset.ts';
import { trainModelPipeline, validateAndParseCsv } from './ml/engine.ts';

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'truthlens.db');
export const DATASETS_DIR = path.join(DATA_DIR, 'datasets');
export const MODELS_DIR = path.join(DATA_DIR, 'models');

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(DATASETS_DIR, { recursive: true });
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    initSchema(dbInstance);
    seedInitialData(dbInstance);
  }
  return dbInstance;
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dataset_format TEXT NOT NULL DEFAULT 'custom',
      file_reference TEXT NOT NULL,
      column_mapping_json TEXT,
      record_count INTEGER NOT NULL DEFAULT 0,
      fake_count INTEGER NOT NULL DEFAULT 0,
      real_count INTEGER NOT NULL DEFAULT 0,
      duplicates_removed INTEGER NOT NULL DEFAULT 0,
      missing_removed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'validated',
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS model_versions (
      id TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      version TEXT NOT NULL,
      dataset_id TEXT NOT NULL,
      accuracy REAL NOT NULL DEFAULT 0,
      precision_score REAL NOT NULL DEFAULT 0,
      recall_score REAL NOT NULL DEFAULT 0,
      f1_score REAL NOT NULL DEFAULT 0,
      roc_auc REAL NOT NULL DEFAULT 0,
      confusion_matrix_json TEXT,
      cv_scores_json TEXT,
      hyperparams_json TEXT,
      artifact_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'trained' CHECK (status IN ('trained', 'active', 'archived', 'failed')),
      error_message TEXT,
      trained_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      input_mode TEXT NOT NULL DEFAULT 'article',
      headline TEXT,
      article_text TEXT NOT NULL,
      source_url TEXT,
      extracted_meta_json TEXT,
      prediction TEXT NOT NULL CHECK (prediction IN ('REAL', 'FAKE', 'UNCERTAIN')),
      confidence REAL NOT NULL,
      model_name TEXT NOT NULL,
      model_version TEXT NOT NULL,
      explanation_json TEXT NOT NULL,
      source_credibility_json TEXT,
      limitations_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      feedback_type TEXT NOT NULL,
      rating INTEGER,
      comments TEXT,
      reference_url TEXT,
      moderation_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS verification_sources (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      claim_text TEXT,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      finding TEXT NOT NULL,
      stance TEXT DEFAULT 'context',
      publication_date TEXT,
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS training_jobs (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      current_step TEXT,
      algorithms_json TEXT,
      results_json TEXT,
      error TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_user_created ON analyses(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analyses_prediction ON analyses(prediction);
    CREATE INDEX IF NOT EXISTS idx_model_versions_status ON model_versions(status);
    CREATE INDEX IF NOT EXISTS idx_feedback_analysis ON feedback(analysis_id);
  `);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hash, 'hex');
  if (candidate.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(candidate, storedBuf);
}

const TOKEN_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET !== 'change-me-in-production-use-long-random-hex'
    ? process.env.JWT_SECRET
    : crypto.createHash('sha256').update(`truthlens-session-${DATA_DIR}`).digest('hex');

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: 'user' | 'admin';
  exp: number;
}

export function signToken(payload: Omit<AuthTokenPayload, 'exp'>): string {
  const full: AuthTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', TOKEN_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (sig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!parsed.sub || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function seedInitialData(db: DatabaseSync) {
  const userCountRow = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (userCountRow.c === 0) {
    const insertUser = db.prepare(
      'INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)'
    );
    insertUser.run(
      crypto.randomUUID(),
      'Dr. Elena Vance (Admin)',
      'admin@truthlens.ai',
      hashPassword('AdminTruth2026!'),
      'admin'
    );
    insertUser.run(
      crypto.randomUUID(),
      'Marcus Chen (Researcher)',
      'researcher@truthlens.ai',
      hashPassword('Research2026!'),
      'user'
    );
  }

  // Ensure curated benchmark dataset exists and initial real ML models are trained on first run
  // (or recovered if database persisted across container snapshots without data/models files)
  const datasetCountRow = db.prepare('SELECT COUNT(*) as c FROM datasets').get() as { c: number };
  const activeModelRow = db
    .prepare('SELECT id, artifact_path FROM model_versions WHERE status = ? LIMIT 1')
    .get('active') as { id: string; artifact_path: string } | undefined;
  const resolveArtifactExists = (artifactPath: string) =>
    fs.existsSync(artifactPath) || fs.existsSync(path.join(MODELS_DIR, path.basename(artifactPath)));
  const activeArtifactMissing = activeModelRow && !resolveArtifactExists(activeModelRow.artifact_path);

  if (datasetCountRow.c === 0 || activeArtifactMissing || !activeModelRow) {
    const csvPath = ensureSeedDatasetCsv(DATASETS_DIR);
    const parsed = validateAndParseCsv(fs.readFileSync(csvPath));

    let datasetId: string;
    if (datasetCountRow.c === 0) {
      datasetId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO datasets (id, name, dataset_format, file_reference, column_mapping_json, record_count, fake_count, real_count, duplicates_removed, missing_removed, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        datasetId,
        'WELFake Curated Benchmark Corpus',
        'welfake',
        csvPath,
        JSON.stringify(parsed.detectedMapping),
        parsed.validRows,
        parsed.fakeCount,
        parsed.realCount,
        parsed.duplicatesRemoved,
        parsed.missingRemoved,
        'validated'
      );
    } else {
      const existingDs = db
        .prepare('SELECT id FROM datasets ORDER BY uploaded_at ASC LIMIT 1')
        .get() as { id: string };
      datasetId = existingDs.id;
      // Remove orphaned model rows whose artifact JSON files are missing on disk
      const allModels = db
        .prepare('SELECT id, artifact_path FROM model_versions')
        .all() as Array<{ id: string; artifact_path: string }>;
      for (const m of allModels) {
        if (!resolveArtifactExists(m.artifact_path)) {
          db.prepare('DELETE FROM model_versions WHERE id = ?').run(m.id);
        }
      }
    }

    const remainingActive = db
      .prepare('SELECT id FROM model_versions WHERE status = ? LIMIT 1')
      .get('active') as { id: string } | undefined;

    if (!remainingActive) {
      // Train all 3 real models on the initial corpus and activate Logistic Regression v1.0.0
      const algorithms = ['tfidf_logreg', 'tfidf_nb', 'tfidf_svm'] as const;
      for (const algo of algorithms) {
        const modelId = crypto.randomUUID();
        const { artifact, artifactPath } = trainModelPipeline({
          modelId,
          version: 'v1.0.0',
          algorithm: algo,
          datasetId,
          datasetName: 'WELFake Curated Benchmark Corpus',
          records: parsed.records,
          testRatio: 0.2,
          cvFolds: 3,
          modelsDir: MODELS_DIR,
        });

        const status = algo === 'tfidf_logreg' ? 'active' : 'trained';
        db.prepare(
          `INSERT INTO model_versions (id, model_name, algorithm, version, dataset_id, accuracy, precision_score, recall_score, f1_score, roc_auc, confusion_matrix_json, cv_scores_json, hyperparams_json, artifact_path, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          modelId,
          artifact.model_name,
          algo,
          artifact.version,
          datasetId,
          artifact.metrics.accuracy,
          artifact.metrics.precision,
          artifact.metrics.recall,
          artifact.metrics.f1_score,
          artifact.metrics.roc_auc,
          JSON.stringify(artifact.metrics.confusion_matrix),
          JSON.stringify({
            cv_accuracy_mean: artifact.metrics.cv_accuracy_mean,
            cv_f1_mean: artifact.metrics.cv_f1_mean,
            brier_score: artifact.metrics.brier_score,
            per_class: artifact.metrics.per_class,
            train_size: artifact.metrics.train_size,
            test_size: artifact.metrics.test_size,
          }),
          JSON.stringify(artifact.preprocess),
          artifactPath,
          status
        );
      }
    }
  }
}

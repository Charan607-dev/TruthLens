import 'dotenv/config';
import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  DATASETS_DIR,
  MODELS_DIR,
  getDb,
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
} from './server/db.ts';
import {
  AlgorithmId,
  ColumnMapping,
  loadModelArtifact,
  predictWithExplanation,
  trainModelPipeline,
  validateAndParseCsv,
} from './server/ml/engine.ts';
import { verifyClaimsIndependently } from './server/services/factChecker.ts';
import { analyzeSourceCredibility } from './server/services/sourceCredibility.ts';
import { fetchAndExtractArticle } from './server/services/urlExtractor.ts';

interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: 'user' | 'admin';
  created_at: string;
}

interface AuthedRequest extends Request {
  user?: AuthUser;
}

// Simple sliding-window rate limiter
const rateBuckets = new Map<string, number[]>();
function rateLimit(maxHits: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= maxHits) {
      return res.status(429).json({
        error: 'Too many requests. Please wait briefly before retrying.',
      });
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    next();
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }
  const db = getDb();
  const user = db
    .prepare('SELECT id, full_name, email, role, created_at FROM users WHERE id = ?')
    .get(payload.sub) as unknown as AuthUser | undefined;
  if (!user) {
    return res.status(401).json({ error: 'User account not found.' });
  }
  req.user = user;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator privileges required.' });
  }
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv' && !file.mimetype.includes('csv') && file.mimetype !== 'text/plain') {
      return cb(new Error('Only .csv dataset files are permitted.'));
    }
    cb(null, true);
  },
});

async function startServer() {
  // Initialize SQLite database & ensure initial benchmark models exist
  const db = getDb();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // Secret-free structured logging for /api requests
  app.use('/api', (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const elapsed = Date.now() - start;
      console.log(`[API] ${req.method} ${req.originalUrl.split('?')[0]} -> ${res.statusCode} (${elapsed}ms)`);
    });
    next();
  });

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    const activeModel = db
      .prepare('SELECT id, model_name, version, trained_at FROM model_versions WHERE status = ? LIMIT 1')
      .get('active') as { id: string; model_name: string; version: string; trained_at: string } | undefined;
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      ml_model_active: Boolean(activeModel),
      active_model: activeModel || null,
      fact_check_grounding: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    });
  });

  // Public metrics endpoint for Landing Page (strictly real DB evaluation metrics)
  app.get('/api/public/model-metrics', (_req, res) => {
    const models = db
      .prepare(
        `SELECT m.id, m.model_name, m.algorithm, m.version, m.accuracy, m.precision_score, m.recall_score, m.f1_score, m.roc_auc, m.confusion_matrix_json, m.cv_scores_json, m.status, m.trained_at, d.name as dataset_name, d.record_count
         FROM model_versions m
         JOIN datasets d ON m.dataset_id = d.id
         WHERE m.status IN ('active', 'trained')
         ORDER BY m.trained_at DESC LIMIT 6`
      )
      .all() as Array<Record<string, unknown>>;

    const active = models.find((m) => m.status === 'active') || null;
    res.json({
      active_model: active
        ? {
            ...active,
            confusion_matrix: active.confusion_matrix_json
              ? JSON.parse(String(active.confusion_matrix_json))
              : null,
            cv_scores: active.cv_scores_json ? JSON.parse(String(active.cv_scores_json)) : null,
          }
        : null,
      models: models.map((m) => ({
        ...m,
        confusion_matrix: m.confusion_matrix_json ? JSON.parse(String(m.confusion_matrix_json)) : null,
        cv_scores: m.cv_scores_json ? JSON.parse(String(m.cv_scores_json)) : null,
      })),
    });
  });

  // Public live demonstration sample analysis on Landing Page using real active model (no DB save)
  app.post('/api/public/demo-analyze', rateLimit(20, 60_000), (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (text.length < 20) {
      return res.status(400).json({ error: 'Provide at least 20 characters for live demonstration.' });
    }
    const activeRow = db
      .prepare('SELECT * FROM model_versions WHERE status = ? ORDER BY trained_at DESC LIMIT 1')
      .get('active') as Record<string, unknown> | undefined;
    if (!activeRow) {
      return res.status(503).json({ error: 'Model not trained. Active model required.' });
    }
    try {
      const artifact = loadModelArtifact(String(activeRow.artifact_path));
      const result = predictWithExplanation(text.slice(0, 3000), artifact, 0.62);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Prediction failed' });
    }
  });

  // ================= AUTHENTICATION =================
  app.post('/api/auth/register', rateLimit(15, 60_000), (req, res) => {
    const fullName = String(req.body?.full_name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (fullName.length < 2) {
      return res.status(400).json({ error: 'Full name must be at least 2 characters.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const id = crypto.randomUUID();
    const passwordHash = hashPassword(password);
    db.prepare('INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
      id,
      fullName,
      email,
      passwordHash,
      'user'
    );

    const user = db
      .prepare('SELECT id, full_name, email, role, created_at FROM users WHERE id = ?')
      .get(id) as unknown as AuthUser;
    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    res.status(201).json({ token, user });
  });

  app.post('/api/auth/login', rateLimit(20, 60_000), (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const row = db
      .prepare('SELECT id, full_name, email, password_hash, role, created_at FROM users WHERE email = ?')
      .get(email) as (AuthUser & { password_hash: string }) | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user: AuthUser = {
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      role: row.role,
      created_at: row.created_at,
    };
    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    res.json({ token, user });
  });

  app.get('/api/auth/google-status', (_req, res) => {
    const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
    res.json({
      configured,
      message: configured
        ? 'Google OAuth available via Supabase Auth.'
        : 'Google OAuth requires SUPABASE_URL and SUPABASE_ANON_KEY with Google provider enabled in Supabase Dashboard.',
    });
  });

  app.post('/api/auth/forgot-password', rateLimit(10, 60_000), (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) {
      return res.json({
        message: 'If an account matches that email, a password reset token has been generated.',
      });
    }
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO password_resets (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)').run(
      token,
      user.id,
      expiresAt
    );
    // For local academic/dev environment without SMTP configured, return reset link token clearly
    res.json({
      message: 'Password reset token generated. Valid for 30 minutes.',
      dev_reset_token: token,
    });
  });

  app.post('/api/auth/reset-password', rateLimit(10, 60_000), (req, res) => {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.new_password || '');
    if (!token || newPassword.length < 8) {
      return res.status(400).json({ error: 'Valid reset token and password (min 8 chars) required.' });
    }

    const row = db
      .prepare('SELECT token, user_id, expires_at, used FROM password_resets WHERE token = ?')
      .get(token) as { token: string; user_id: string; expires_at: string; used: number } | undefined;

    if (!row || row.used === 1 || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Reset token is invalid or expired.' });
    }

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), row.user_id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').run(token);
    res.json({ message: 'Password updated successfully. You may now sign in.' });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  app.patch('/api/auth/profile', requireAuth, (req: AuthedRequest, res) => {
    const fullName = String(req.body?.full_name || '').trim();
    if (fullName.length < 2) {
      return res.status(400).json({ error: 'Full name must be at least 2 characters.' });
    }
    db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(fullName, req.user!.id);
    const updated = db
      .prepare('SELECT id, full_name, email, role, created_at FROM users WHERE id = ?')
      .get(req.user!.id) as unknown as AuthUser;
    res.json({ user: updated });
  });

  // ================= MODEL INFO =================
  app.get('/api/model/info', requireAuth, (_req, res) => {
    const row = db
      .prepare(
        `SELECT m.*, d.name as dataset_name, d.record_count as dataset_size
         FROM model_versions m
         JOIN datasets d ON m.dataset_id = d.id
         WHERE m.status = 'active'
         ORDER BY m.trained_at DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;

    if (!row) {
      return res.json({
        trained: false,
        status: 'Model not trained',
        message: 'No active trained model is currently deployed. An administrator must train and activate a model.',
      });
    }

    res.json({
      trained: true,
      id: row.id,
      model_name: row.model_name,
      algorithm: row.algorithm,
      version: row.version,
      dataset_name: row.dataset_name,
      dataset_size: row.dataset_size,
      accuracy: row.accuracy,
      precision: row.precision_score,
      recall: row.recall_score,
      f1_score: row.f1_score,
      roc_auc: row.roc_auc,
      confusion_matrix: row.confusion_matrix_json ? JSON.parse(String(row.confusion_matrix_json)) : null,
      cv_scores: row.cv_scores_json ? JSON.parse(String(row.cv_scores_json)) : null,
      trained_at: row.trained_at,
      status: row.status,
    });
  });

  // ================= ANALYZE & URL EXTRACTION =================
  app.post('/api/analyze-url', requireAuth, rateLimit(20, 60_000), async (req: AuthedRequest, res) => {
    const rawUrl = String(req.body?.url || '').trim();
    const previewOnly = Boolean(req.body?.preview_only);
    const runFactCheck = Boolean(req.body?.run_fact_check);
    const threshold = Math.min(0.9, Math.max(0.5, Number(req.body?.uncertainty_threshold || 0.62)));

    if (!rawUrl) {
      return res.status(400).json({ error: 'News article URL is required.' });
    }

    try {
      const extracted = await fetchAndExtractArticle(rawUrl);
      const sourceCredibility = analyzeSourceCredibility({
        sourceUrl: extracted.url,
        author: extracted.author,
        publishedDate: extracted.published_date,
        siteName: extracted.site_name,
      });

      if (previewOnly) {
        return res.json({
          extracted,
          source_credibility: sourceCredibility,
        });
      }

      const activeRow = db
        .prepare('SELECT * FROM model_versions WHERE status = ? ORDER BY trained_at DESC LIMIT 1')
        .get('active') as Record<string, unknown> | undefined;
      if (!activeRow) {
        return res.status(503).json({ error: 'Model not trained. Please train and activate a model first.' });
      }

      const artifact = loadModelArtifact(String(activeRow.artifact_path));
      const combined = `${extracted.title}. ${extracted.body}`;
      const mlResult = predictWithExplanation(combined, artifact, threshold);
      const factCheck = runFactCheck
        ? await verifyClaimsIndependently(extracted.title, extracted.body)
        : {
            available: false,
            reason: 'Independent evidence lookup was not requested for this run.',
            extracted_claims: [],
            references: [],
          };

      const analysisId = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      db.prepare(
        `INSERT INTO analyses (id, user_id, input_mode, headline, article_text, source_url, extracted_meta_json, prediction, confidence, model_name, model_version, explanation_json, source_credibility_json, limitations_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        analysisId,
        req.user!.id,
        'url',
        extracted.title,
        extracted.body,
        extracted.url,
        JSON.stringify({
          author: extracted.author,
          published_date: extracted.published_date,
          site_name: extracted.site_name,
          word_count: extracted.word_count,
        }),
        mlResult.prediction,
        mlResult.confidence,
        mlResult.model_name,
        mlResult.model_version,
        JSON.stringify(mlResult),
        JSON.stringify(sourceCredibility),
        JSON.stringify(mlResult.limitations),
        createdAt
      );

      for (const ref of factCheck.references) {
        db.prepare(
          `INSERT INTO verification_sources (id, analysis_id, claim_text, source_name, source_url, finding, stance, publication_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          analysisId,
          ref.claim_text,
          ref.source_name,
          ref.source_url,
          ref.finding,
          ref.stance,
          ref.publication_date
        );
      }

      res.status(201).json({
        id: analysisId,
        created_at: createdAt,
        input_mode: 'url',
        headline: extracted.title,
        article_text: extracted.body,
        source_url: extracted.url,
        extracted_meta: extracted,
        ml_result: mlResult,
        source_credibility: sourceCredibility,
        fact_check: factCheck,
      });
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to extract and analyze URL.',
      });
    }
  });

  app.post('/api/analyze', requireAuth, rateLimit(30, 60_000), async (req: AuthedRequest, res) => {
    const mode = req.body?.mode === 'headline' ? 'headline' : req.body?.mode === 'url' ? 'url' : 'article';
    const headline = String(req.body?.headline || '').trim();
    const articleText = String(req.body?.article_text || '').trim();
    const sourceUrl = req.body?.source_url ? String(req.body.source_url).trim() : null;
    const author = req.body?.author ? String(req.body.author).trim() : null;
    const publishedDate = req.body?.published_date ? String(req.body.published_date).trim() : null;
    const runFactCheck = Boolean(req.body?.run_fact_check);
    const threshold = Math.min(0.9, Math.max(0.5, Number(req.body?.uncertainty_threshold || 0.62)));

    if (mode === 'headline' && headline.length < 12) {
      return res.status(400).json({ error: 'Headline must be at least 12 characters long.' });
    }
    if (mode !== 'headline' && articleText.length < 40) {
      return res.status(400).json({ error: 'Article text must be at least 40 characters long.' });
    }

    const activeRow = db
      .prepare('SELECT * FROM model_versions WHERE status = ? ORDER BY trained_at DESC LIMIT 1')
      .get('active') as Record<string, unknown> | undefined;

    if (!activeRow) {
      return res.status(503).json({
        error: 'Model not trained. No active trained model is available for production predictions.',
      });
    }

    try {
      const artifact = loadModelArtifact(String(activeRow.artifact_path));
      const fullTextForMl =
        mode === 'headline'
          ? headline
          : headline
            ? `${headline}. ${articleText}`
            : articleText;

      const mlResult = predictWithExplanation(fullTextForMl, artifact, threshold);
      const sourceCredibility = analyzeSourceCredibility({
        sourceUrl,
        author,
        publishedDate,
      });
      const factCheck = runFactCheck
        ? await verifyClaimsIndependently(headline || null, fullTextForMl)
        : {
            available: false,
            reason: 'Independent evidence search was not enabled for this request.',
            extracted_claims: [],
            references: [],
          };

      const analysisId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const storedHeadline = headline || articleText.slice(0, 110);
      const storedBody = articleText || headline;

      db.prepare(
        `INSERT INTO analyses (id, user_id, input_mode, headline, article_text, source_url, extracted_meta_json, prediction, confidence, model_name, model_version, explanation_json, source_credibility_json, limitations_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        analysisId,
        req.user!.id,
        mode,
        storedHeadline,
        storedBody,
        sourceUrl,
        JSON.stringify({ author, published_date: publishedDate }),
        mlResult.prediction,
        mlResult.confidence,
        mlResult.model_name,
        mlResult.model_version,
        JSON.stringify(mlResult),
        JSON.stringify(sourceCredibility),
        JSON.stringify(mlResult.limitations),
        createdAt
      );

      for (const ref of factCheck.references) {
        db.prepare(
          `INSERT INTO verification_sources (id, analysis_id, claim_text, source_name, source_url, finding, stance, publication_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          analysisId,
          ref.claim_text,
          ref.source_name,
          ref.source_url,
          ref.finding,
          ref.stance,
          ref.publication_date
        );
      }

      res.status(201).json({
        id: analysisId,
        created_at: createdAt,
        input_mode: mode,
        headline: storedHeadline,
        article_text: storedBody,
        source_url: sourceUrl,
        ml_result: mlResult,
        source_credibility: sourceCredibility,
        fact_check: factCheck,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Prediction engine failed.',
      });
    }
  });

  // ================= HISTORY =================
  app.get('/api/history', requireAuth, (req: AuthedRequest, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const prediction = String(req.query.prediction || 'ALL').toUpperCase();
    const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';

    let sql = `SELECT id, input_mode, headline, source_url, prediction, confidence, model_name, model_version, created_at
               FROM analyses WHERE user_id = ?`;
    const params: Array<string | number | null> = [req.user!.id];

    if (prediction === 'REAL' || prediction === 'FAKE' || prediction === 'UNCERTAIN') {
      sql += ' AND prediction = ?';
      params.push(prediction);
    }
    if (search) {
      sql += ' AND (LOWER(headline) LIKE ? OR LOWER(article_text) LIKE ? OR LOWER(COALESCE(source_url, \'\')) LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY created_at ${sort} LIMIT 100`;

    const rows = db.prepare(sql).all(...params);
    res.json({ items: rows });
  });

  app.get('/api/history/:id', requireAuth, (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      return res.status(404).json({ error: 'Analysis record not found.' });
    }
    if (row.user_id !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You do not have permission to view this analysis.' });
    }

    const references = db
      .prepare('SELECT * FROM verification_sources WHERE analysis_id = ?')
      .all(req.params.id);

    res.json({
      id: row.id,
      user_id: row.user_id,
      input_mode: row.input_mode,
      headline: row.headline,
      article_text: row.article_text,
      source_url: row.source_url,
      extracted_meta: row.extracted_meta_json ? JSON.parse(String(row.extracted_meta_json)) : null,
      prediction: row.prediction,
      confidence: row.confidence,
      model_name: row.model_name,
      model_version: row.model_version,
      ml_result: JSON.parse(String(row.explanation_json)),
      source_credibility: row.source_credibility_json
        ? JSON.parse(String(row.source_credibility_json))
        : null,
      limitations: row.limitations_json ? JSON.parse(String(row.limitations_json)) : [],
      verification_sources: references,
      created_at: row.created_at,
    });
  });

  app.delete('/api/history/:id', requireAuth, (req: AuthedRequest, res) => {
    const row = db.prepare('SELECT user_id FROM analyses WHERE id = ?').get(req.params.id) as
      | { user_id: string }
      | undefined;
    if (!row) {
      return res.status(404).json({ error: 'Analysis record not found.' });
    }
    if (row.user_id !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You cannot delete another user’s analysis.' });
    }
    db.prepare('DELETE FROM analyses WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  });

  // ================= DASHBOARD STATS =================
  app.get('/api/dashboard/stats', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.user!.id;

    const counts = db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN prediction = 'FAKE' THEN 1 ELSE 0 END) as fake_count,
           SUM(CASE WHEN prediction = 'REAL' THEN 1 ELSE 0 END) as real_count,
           SUM(CASE WHEN prediction = 'UNCERTAIN' THEN 1 ELSE 0 END) as uncertain_count
         FROM analyses WHERE user_id = ?`
      )
      .get(userId) as {
      total: number;
      fake_count: number | null;
      real_count: number | null;
      uncertain_count: number | null;
    };

    const dailyRows = db
      .prepare(
        `SELECT substr(created_at, 1, 10) as day,
                COUNT(*) as total,
                SUM(CASE WHEN prediction = 'FAKE' THEN 1 ELSE 0 END) as fake,
                SUM(CASE WHEN prediction = 'REAL' THEN 1 ELSE 0 END) as real,
                SUM(CASE WHEN prediction = 'UNCERTAIN' THEN 1 ELSE 0 END) as uncertain
         FROM analyses
         WHERE user_id = ?
         GROUP BY substr(created_at, 1, 10)
         ORDER BY day ASC
         LIMIT 14`
      )
      .all(userId);

    const recent = db
      .prepare(
        `SELECT id, input_mode, headline, source_url, prediction, confidence, model_name, model_version, created_at
         FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 6`
      )
      .all(userId);

    const activeModel = db
      .prepare(
        `SELECT m.id, m.model_name, m.algorithm, m.version, m.accuracy, m.precision_score, m.recall_score, m.f1_score, m.roc_auc, m.trained_at, d.name as dataset_name, d.record_count
         FROM model_versions m
         JOIN datasets d ON m.dataset_id = d.id
         WHERE m.status = 'active'
         ORDER BY m.trained_at DESC LIMIT 1`
      )
      .get();

    res.json({
      totals: {
        total: counts.total || 0,
        fake: counts.fake_count || 0,
        real: counts.real_count || 0,
        uncertain: counts.uncertain_count || 0,
      },
      daily_activity: dailyRows,
      recent_analyses: recent,
      active_model: activeModel || null,
    });
  });

  // ================= FEEDBACK =================
  app.post('/api/feedback', requireAuth, (req: AuthedRequest, res) => {
    const analysisId = String(req.body?.analysis_id || '').trim();
    const feedbackType = String(req.body?.feedback_type || '').trim();
    const rating = req.body?.rating !== undefined ? Number(req.body.rating) : null;
    const comments = String(req.body?.comments || '').trim();
    const referenceUrl = req.body?.reference_url ? String(req.body.reference_url).trim() : null;

    if (!analysisId || !feedbackType) {
      return res.status(400).json({ error: 'Analysis ID and feedback type are required.' });
    }
    const analysis = db.prepare('SELECT id FROM analyses WHERE id = ?').get(analysisId);
    if (!analysis) {
      return res.status(404).json({ error: 'Referenced analysis record does not exist.' });
    }

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO feedback (id, user_id, analysis_id, feedback_type, rating, comments, reference_url, moderation_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(id, req.user!.id, analysisId, feedbackType, rating, comments, referenceUrl);

    res.status(201).json({
      id,
      message: 'Feedback recorded separately from training datasets for administrator review.',
    });
  });

  // ================= ADMIN ROUTES =================
  app.post(
    '/api/admin/datasets/preview',
    requireAuth,
    requireAdmin,
    upload.single('file'),
    (req: AuthedRequest, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'Please select a CSV file to inspect.' });
      }
      try {
        const numericFake = req.body?.numeric_fake_value === '0' ? '0' : '1';
        const mapping: Partial<ColumnMapping> = {};
        if (req.body?.title_col) mapping.titleCol = String(req.body.title_col);
        if (req.body?.text_col) mapping.textCol = String(req.body.text_col);
        if (req.body?.label_col) mapping.labelCol = String(req.body.label_col);

        const parsed = validateAndParseCsv(req.file.buffer, mapping, numericFake);
        res.json({
          headers: parsed.headers,
          detected_mapping: parsed.detectedMapping,
          total_rows: parsed.totalRows,
          valid_rows: parsed.validRows,
          fake_count: parsed.fakeCount,
          real_count: parsed.realCount,
          duplicates_removed: parsed.duplicatesRemoved,
          missing_removed: parsed.missingRemoved,
          invalid_label_rows: parsed.invalidLabelRows,
          sample_rows: parsed.sampleRows,
          warnings: parsed.warnings,
        });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to parse CSV.' });
      }
    }
  );

  app.post(
    '/api/admin/datasets/upload',
    requireAuth,
    requireAdmin,
    upload.single('file'),
    (req: AuthedRequest, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'CSV dataset file is required.' });
      }
      try {
        const name = String(req.body?.name || req.file.originalname.replace(/\.csv$/i, '')).trim();
        const format = String(req.body?.dataset_format || 'custom').trim();
        const numericFake = req.body?.numeric_fake_value === '0' ? '0' : '1';
        const mapping: Partial<ColumnMapping> = {};
        if (req.body?.title_col) mapping.titleCol = String(req.body.title_col);
        if (req.body?.text_col) mapping.textCol = String(req.body.text_col);
        if (req.body?.label_col) mapping.labelCol = String(req.body.label_col);

        const parsed = validateAndParseCsv(req.file.buffer, mapping, numericFake);
        const datasetId = crypto.randomUUID();
        const safeName = `${datasetId}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = path.join(DATASETS_DIR, safeName);
        fs.writeFileSync(filePath, req.file.buffer);

        db.prepare(
          `INSERT INTO datasets (id, name, dataset_format, file_reference, column_mapping_json, record_count, fake_count, real_count, duplicates_removed, missing_removed, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          datasetId,
          name,
          format,
          filePath,
          JSON.stringify({ ...parsed.detectedMapping, numericFake }),
          parsed.validRows,
          parsed.fakeCount,
          parsed.realCount,
          parsed.duplicatesRemoved,
          parsed.missingRemoved,
          'validated'
        );

        res.status(201).json({
          id: datasetId,
          name,
          dataset_format: format,
          record_count: parsed.validRows,
          fake_count: parsed.fakeCount,
          real_count: parsed.realCount,
          duplicates_removed: parsed.duplicatesRemoved,
          missing_removed: parsed.missingRemoved,
          warnings: parsed.warnings,
        });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Dataset validation failed.' });
      }
    }
  );

  app.get('/api/admin/datasets', requireAuth, requireAdmin, (_req, res) => {
    const rows = db.prepare('SELECT * FROM datasets ORDER BY uploaded_at DESC').all();
    res.json({ datasets: rows });
  });

  app.post('/api/admin/train', requireAuth, requireAdmin, (req, res) => {
    const datasetId = String(req.body?.dataset_id || '').trim();
    const requestedAlgos: AlgorithmId[] = Array.isArray(req.body?.algorithms)
      ? req.body.algorithms.filter((a: unknown) =>
          ['tfidf_logreg', 'tfidf_nb', 'tfidf_svm'].includes(String(a))
        )
      : ['tfidf_logreg', 'tfidf_nb', 'tfidf_svm'];

    if (!datasetId || requestedAlgos.length === 0) {
      return res.status(400).json({ error: 'Valid dataset_id and at least one algorithm are required.' });
    }

    const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId) as
      | Record<string, unknown>
      | undefined;
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found.' });
    }

    const testRatio = Math.min(0.4, Math.max(0.1, Number(req.body?.test_ratio || 0.2)));
    const cvFolds = Math.min(5, Math.max(2, Number(req.body?.cv_folds || 3)));
    const removeStopwords = req.body?.remove_stopwords !== false;
    const useBigrams = req.body?.use_bigrams !== false;
    const maxFeatures = Math.min(10000, Math.max(500, Number(req.body?.max_features || 6500)));

    const jobId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO training_jobs (id, dataset_id, status, progress, current_step, algorithms_json)
       VALUES (?, ?, 'running', 5, 'Loading and cleaning dataset...', ?)`
    ).run(jobId, datasetId, JSON.stringify(requestedAlgos));

    // Execute training asynchronously so UI polls real progress steps
    setTimeout(() => {
      try {
        const fileBuf = fs.readFileSync(String(dataset.file_reference));
        const mappingMeta = dataset.column_mapping_json
          ? JSON.parse(String(dataset.column_mapping_json))
          : {};
        const parsed = validateAndParseCsv(
          fileBuf,
          mappingMeta,
          mappingMeta.numericFake === '0' ? '0' : '1'
        );

        const existingCount = (
          db.prepare('SELECT COUNT(*) as c FROM model_versions').get() as { c: number }
        ).c;
        const versionTag = `v1.${existingCount}.0`;
        const trainedResults: Array<Record<string, unknown>> = [];

        requestedAlgos.forEach((algo, idx) => {
          const stepPct = Math.round(((idx + 0.3) / requestedAlgos.length) * 85) + 10;
          db.prepare('UPDATE training_jobs SET progress = ?, current_step = ? WHERE id = ?').run(
            stepPct,
            `Training & cross-validating ${algo}...`,
            jobId
          );

          const modelId = crypto.randomUUID();
          const { artifact, artifactPath } = trainModelPipeline({
            modelId,
            version: versionTag,
            algorithm: algo,
            datasetId,
            datasetName: String(dataset.name),
            records: parsed.records,
            testRatio,
            cvFolds,
            preprocess: {
              removeStopwords,
              useBigrams,
              maxFeatures,
              minDf: parsed.records.length < 600 ? 1 : 2,
            },
            modelsDir: MODELS_DIR,
          });

          // Never automatically activate unvalidated models!
          db.prepare(
            `INSERT INTO model_versions (id, model_name, algorithm, version, dataset_id, accuracy, precision_score, recall_score, f1_score, roc_auc, confusion_matrix_json, cv_scores_json, hyperparams_json, artifact_path, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trained')`
          ).run(
            modelId,
            artifact.model_name,
            algo,
            versionTag,
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
            artifactPath
          );

          trainedResults.push({
            id: modelId,
            model_name: artifact.model_name,
            algorithm: algo,
            version: versionTag,
            metrics: artifact.metrics,
          });
        });

        db.prepare(
          `UPDATE training_jobs SET status = 'completed', progress = 100, current_step = 'Training & evaluation complete. Review metrics before activating.', results_json = ?, completed_at = datetime('now') WHERE id = ?`
        ).run(JSON.stringify(trainedResults), jobId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Training pipeline failed.';
        db.prepare(
          `UPDATE training_jobs SET status = 'failed', current_step = 'Training failed; previous active model preserved.', error = ?, completed_at = datetime('now') WHERE id = ?`
        ).run(msg, jobId);
      }
    }, 150);

    res.status(202).json({ job_id: jobId, status: 'running' });
  });

  app.get('/api/admin/train/status', requireAuth, requireAdmin, (req, res) => {
    const jobId = req.query.job_id ? String(req.query.job_id) : null;
    const job = jobId
      ? db.prepare('SELECT * FROM training_jobs WHERE id = ?').get(jobId)
      : db.prepare('SELECT * FROM training_jobs ORDER BY started_at DESC LIMIT 1').get();
    if (!job) {
      return res.json({ status: 'idle', progress: 0 });
    }
    const row = job as Record<string, unknown>;
    res.json({
      ...row,
      results: row.results_json ? JSON.parse(String(row.results_json)) : [],
    });
  });

  app.get('/api/admin/models', requireAuth, requireAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT m.*, d.name as dataset_name, d.record_count as dataset_size
         FROM model_versions m
         JOIN datasets d ON m.dataset_id = d.id
         ORDER BY m.trained_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      models: rows.map((r) => ({
        ...r,
        confusion_matrix: r.confusion_matrix_json ? JSON.parse(String(r.confusion_matrix_json)) : null,
        cv_scores: r.cv_scores_json ? JSON.parse(String(r.cv_scores_json)) : null,
        hyperparams: r.hyperparams_json ? JSON.parse(String(r.hyperparams_json)) : null,
      })),
    });
  });

  app.post('/api/admin/models/activate', requireAuth, requireAdmin, (req, res) => {
    const modelId = String(req.body?.model_id || '').trim();
    const deactivateAll = Boolean(req.body?.deactivate);

    if (deactivateAll) {
      db.prepare(`UPDATE model_versions SET status = 'trained' WHERE status = 'active'`).run();
      return res.json({ active_model_id: null, message: 'Active model deactivated.' });
    }

    const model = db.prepare('SELECT * FROM model_versions WHERE id = ?').get(modelId) as
      | Record<string, unknown>
      | undefined;
    if (!model) {
      return res.status(404).json({ error: 'Model version not found.' });
    }
    if (!fs.existsSync(String(model.artifact_path))) {
      return res.status(400).json({ error: 'Cannot activate: model artifact missing on disk.' });
    }

    db.prepare(`UPDATE model_versions SET status = 'trained' WHERE status = 'active'`).run();
    db.prepare(`UPDATE model_versions SET status = 'active' WHERE id = ?`).run(modelId);
    res.json({ active_model_id: modelId, message: `Activated ${model.model_name} (${model.version}).` });
  });

  app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.full_name, u.email, u.role, u.created_at, COUNT(a.id) as analysis_count
         FROM users u
         LEFT JOIN analyses a ON u.id = a.user_id
         GROUP BY u.id
         ORDER BY u.created_at DESC`
      )
      .all();
    res.json({ users });
  });

  app.patch('/api/admin/users/:id/role', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const role = req.body?.role === 'admin' ? 'admin' : 'user';
    if (req.params.id === req.user!.id && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot demote your own admin session.' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
    res.json({ updated: true, role });
  });

  app.get('/api/admin/feedback', requireAuth, requireAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT f.*, u.email as user_email, a.headline, a.prediction, a.confidence
         FROM feedback f
         JOIN users u ON f.user_id = u.id
         JOIN analyses a ON f.analysis_id = a.id
         ORDER BY f.created_at DESC LIMIT 100`
      )
      .all();
    res.json({ feedback: rows });
  });

  app.patch('/api/admin/feedback/:id', requireAuth, requireAdmin, (req, res) => {
    const status = ['pending', 'reviewed', 'dismissed'].includes(String(req.body?.moderation_status))
      ? String(req.body.moderation_status)
      : 'reviewed';
    db.prepare('UPDATE feedback SET moderation_status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ updated: true, moderation_status: status });
  });

  app.get('/api/admin/analyses', requireAuth, requireAdmin, (_req, res) => {
    const analyses = db
      .prepare(
        `SELECT a.id, a.input_mode, a.headline, a.source_url, a.prediction, a.confidence, a.model_name, a.model_version, a.created_at, u.email as user_email
         FROM analyses a
         JOIN users u ON a.user_id = u.id
         ORDER BY a.created_at DESC LIMIT 100`
      )
      .all();
    res.json({ analyses });
  });

  app.get('/api/admin/system', requireAuth, requireAdmin, (_req, res) => {
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    const totalAnalyses = (db.prepare('SELECT COUNT(*) as c FROM analyses').get() as { c: number }).c;
    const totalDatasets = (db.prepare('SELECT COUNT(*) as c FROM datasets').get() as { c: number }).c;
    const totalModels = (db.prepare('SELECT COUNT(*) as c FROM model_versions').get() as { c: number }).c;
    const pendingFeedback = (
      db.prepare(`SELECT COUNT(*) as c FROM feedback WHERE moderation_status = 'pending'`).get() as { c: number }
    ).c;

    res.json({
      total_users: totalUsers,
      total_analyses: totalAnalyses,
      total_datasets: totalDatasets,
      total_models: totalModels,
      pending_feedback: pendingFeedback,
      uptime_seconds: Math.round(process.uptime()),
      node_version: process.version,
      gemini_grounding_configured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
      supabase_configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
  });

  // Unmatched /api routes always return JSON 404 (never HTML)
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // JSON error handler (including malformed JSON bodies)
  app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON request payload.' });
    }
    res.status(400).json({ error: err.message || 'Unexpected server error.' });
  });

  // Vite middleware in development, static dist serving in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(indexPath);
      });
    } else {
      app.get('*', (_req, res) => {
        res.json({
          service: 'TruthLens AI Backend API',
          status: 'running',
          health: '/api/health',
        });
      });
    }
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TruthLens AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start TruthLens AI server:', err);
  process.exit(1);
});

# TruthLens AI

**AI-Powered Fake News Detection, Explainable NLP & Credibility Analysis Platform**

TruthLens AI is a full-stack machine learning and news verification platform designed to classify news headlines, complete articles, and live article URLs into `REAL`, `FAKE`, or `UNCERTAIN`, while separating statistical NLP predictions from domain transparency checks and independent fact-checking references.

> **Scientific Disclaimer:** TruthLens AI predictions reflect statistical linguistic patterns learned from labeled training corpora. A high confidence score does **not** prove factual truth or falsehood.

---

## Architecture Overview

- **Frontend (`src/`)**: React 19, Vite, TypeScript, Tailwind CSS v4, Framer Motion (`motion/react`), Recharts, React Router, jsPDF.
- **Full-Stack Express + ML Runtime (`server.ts`, `server/`)**: Self-contained Node.js 22 server using built-in `node:sqlite`, SSRF-safe HTML extraction (`cheerio`), TF-IDF + Logistic Regression / Multinomial Naive Bayes / Linear SVM training & inference engine (`server/ml/engine.ts`), and optional Gemini Search Grounding (`server/services/factChecker.ts`).
- **Python Flask & Scikit-learn Backend (`backend/`)**: Complete Python REST API (`app.py`), NLTK preprocessing (`ml/preprocess.py`), Scikit-learn + Joblib training pipeline (`ml/train_pipeline.py`), coefficient/log-likelihood explainability (`ml/predict_engine.py`), and optional DistilBERT transformer module (`ml/transformer_model.py`).
- **Database Schema (`supabase/migrations/001_initial_schema.sql`)**: PostgreSQL schema with foreign keys, indexes, and Row Level Security (RLS) policies for `profiles`, `datasets`, `model_versions`, `analyses`, `feedback`, and `verification_sources`.

---

## Local Development (Integrated Node/Vite Full-Stack)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set optional keys:
   ```bash
   cp .env.example .env
   ```
   - `GEMINI_API_KEY` *(optional)*: Enables live Google Search-grounded independent evidence retrieval in the Fact-Checking module.
3. Start the integrated development server on port `3000`:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000`.

### Default Evaluation Accounts
- **Admin:** `admin@truthlens.ai` / `AdminTruth2026!`
- **Researcher:** `researcher@truthlens.ai` / `Research2026!`

*(You can also register new user accounts directly in `/register`.)*

---

## Dataset Preparation (WELFake, ISOT, LIAR)

Supported CSV datasets can be uploaded in **Admin Console → Datasets**:
1. **WELFake Dataset**: Expected columns `title`, `text`, `label` (`0 = FAKE`, `1 = REAL` in Kaggle WELFake — select `0 = FAKE, 1 = REAL` in the upload preset).
2. **ISOT Fake News Dataset**: Combine `Fake.csv` (`label=FAKE`) and `True.csv` (`label=REAL`) into one CSV with `title,text,subject,date,label`.
3. **LIAR Dataset**: Map `statement` as text and `label` (`pants-fire`, `barely-true`, `false` -> `FAKE`; `mostly-true`, `true` -> `REAL`).

The upload validator automatically strips HTML, drops missing/short rows, deduplicates normalized articles, reports exact class balances, and lets administrators override column mappings manually.

---

## Python Flask + Scikit-learn Backend Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

---

## Deployment Guide

### 1. Database (Supabase)
- Create a Supabase project and execute `supabase/migrations/001_initial_schema.sql` in the SQL Editor.
- Enable Email/Password (and optionally Google OAuth) under **Authentication → Providers**.

### 2. Backend (Render / Railway)
- Deploy `/backend` using `render.yaml` (`gunicorn app:app`).
- Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGINS`.

### 3. Frontend (Vercel)
- Connect the repository to Vercel (`npm run build`, output `dist`).
- Update the API destination URL in `vercel.json` to point to your Render/Railway backend URL.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Cpu,
  FileText,
  Globe2,
  Layers,
  Scale,
  ScanSearch,
  Shield,
  Sparkles,
} from 'lucide-react';
import { ConfidenceGauge } from '../components/ConfidenceGauge';
import { HeroIntelligenceVisual } from '../components/HeroIntelligenceVisual';
import { PredictionBadge } from '../components/PredictionBadge';
import { useAuth } from '../context/AuthContext';
import { MlPredictionResult } from '../types';

interface PublicModelRow {
  id: string;
  model_name: string;
  algorithm: string;
  version: string;
  dataset_name: string;
  record_count: number;
  accuracy: number;
  precision_score: number;
  recall_score: number;
  f1_score: number;
  roc_auc: number;
  confusion_matrix: [[number, number], [number, number]] | null;
  status: string;
}

const DEMO_SAMPLES = [
  {
    label: 'Wire Economics Report',
    text: 'WASHINGTON (Reuters) - The Federal Reserve voted unanimously on Wednesday to maintain its benchmark overnight interest rate while signaling that policymakers will review incoming labor market and consumer price index data before making adjustments later this year.',
  },
  {
    label: 'Sensational Hoax Post',
    text: 'BREAKING BOMBSHELL! An anonymous insider leaked explosive documents proving shadowy elites signed a secret midnight treaty to confiscate every paper dollar and freeze citizen bank accounts by next Friday! Share this urgent warning before it gets deleted!',
  },
  {
    label: 'Ambiguous Short Claim',
    text: 'Local council members met yesterday to review quarterly road resurfacing proposals for next spring.',
  },
];

const FAQS = [
  {
    q: 'Does a REAL or FAKE prediction prove an article is factually true or false?',
    a: 'No. TruthLens AI computes a statistical classification based on linguistic patterns learned from labeled news corpora (such as WELFake, ISOT, and LIAR). Confidence scores measure model probability, not factual truth. Always corroborate claims using primary sources and independent fact-checking references.',
  },
  {
    q: 'How are source credibility and text classification separated?',
    a: 'Text classification evaluates linguistic structure and TF-IDF n-gram weights inside the article body, whereas the Source Intelligence module inspects domain transport security, byline metadata, publication timestamps, and transparency registries independently. Unfamiliar domains are never automatically labeled fake.',
  },
  {
    q: 'Which machine learning models power the platform?',
    a: 'TruthLens AI trains and compares TF-IDF + Logistic Regression, TF-IDF + Multinomial Naive Bayes, and TF-IDF + Linear Support Vector Machines (with Platt calibration), plus an optional DistilBERT transformer pipeline in /backend. Held-out test splits and stratified cross-validation prevent data leakage.',
  },
  {
    q: 'What happens when the model has low confidence on short or ambiguous text?',
    a: 'If calibrated probability falls below the configurable uncertainty threshold (default 62%) or vocabulary coverage is insufficient, the engine classifies the submission as UNCERTAIN rather than forcing a misleading binary label.',
  },
];

export function LandingPage() {
  const { user } = useAuth();
  const [demoText, setDemoText] = useState(DEMO_SAMPLES[0].text);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoResult, setDemoResult] = useState<MlPredictionResult | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [modelMetrics, setModelMetrics] = useState<{
    active_model: PublicModelRow | null;
    models: PublicModelRow[];
  }>({ active_model: null, models: [] });
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [techImgFailed, setTechImgFailed] = useState(false);

  const runLiveDemo = async (inputText: string) => {
    setDemoLoading(true);
    setDemoError(null);
    try {
      const res = await fetch('/api/public/demo-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Demo request failed');
      setDemoResult(data);
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Unable to analyze sample.');
    } finally {
      setDemoLoading(false);
    }
  };

  useEffect(() => {
    fetch('/api/public/model-metrics')
      .then((r) => r.json())
      .then((d) => setModelMetrics({ active_model: d.active_model, models: d.models || [] }))
      .catch(() => {});
    runLiveDemo(DEMO_SAMPLES[0].text);
  }, []);

  const handleSelectHeroFragment = (sampleIndex: number) => {
    const sample = DEMO_SAMPLES[sampleIndex] || DEMO_SAMPLES[0];
    setDemoText(sample.text);
    runLiveDemo(sample.text);
    document.getElementById('live-demo')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#080B12] text-[#F3F5F7]">
      {/* 1. Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#080B12]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <Link to="/" className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#C6FF4D] via-[#28DFFF] to-[#9566FF] flex items-center justify-center">
              <Shield className="w-4 h-4 text-[#080B12]" />
            </div>
            <span className="font-display font-bold text-lg tracking-tight text-[#F3F5F7]">
              TRUTHLENS AI
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#929BAD]">
            <a href="#features" className="hover:text-[#F3F5F7] transition-colors whitespace-nowrap shrink-0">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-[#F3F5F7] transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#technology" className="hover:text-[#F3F5F7] transition-colors whitespace-nowrap shrink-0">
              Technology
            </a>
            <a href="#performance" className="hover:text-[#F3F5F7] transition-colors whitespace-nowrap shrink-0">
              Performance
            </a>
          </nav>

          <div className="flex items-center gap-4 shrink-0">
            {user ? (
              <Link
                to="/dashboard"
                className="px-4 py-2 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Open Workspace
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-sm font-medium text-[#929BAD] hover:text-[#F3F5F7] transition-colors whitespace-nowrap shrink-0"
                >
                  Login
                </Link>
                <Link
                  to="/register"
                  className="px-4 py-2 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Start Analysing
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 2. Cinematic Hero Section */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          aria-hidden="true"
          className="absolute -top-36 left-1/4 w-[560px] h-[560px] rounded-full bg-[#28DFFF]/[0.08] blur-[140px] pointer-events-none"
        />
        <div
          aria-hidden="true"
          className="absolute top-12 right-1/6 w-[460px] h-[460px] rounded-full bg-[#9566FF]/[0.1] blur-[140px] pointer-events-none"
        />

        <div className="relative max-w-7xl mx-auto px-6 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="text-xs font-mono tracking-widest text-[#28DFFF]"
            >
              Explainable News Intelligence Platform
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              style={{ fontSize: 'clamp(2.55rem, 4.6vw, 4.15rem)', textWrap: 'balance' }}
              className="font-display font-extrabold tracking-tight text-[#F3F5F7] leading-[1.04]"
            >
              SEE BEYOND
              <br />
              <span className="bg-gradient-to-r from-[#F3F5F7] via-[#28DFFF] to-[#C6FF4D] bg-clip-text text-transparent">
                THE HEADLINE.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="text-base sm:text-lg text-[#929BAD] leading-relaxed max-w-xl"
            >
              Truth is buried beneath millions of headlines. Let artificial intelligence help you examine news, discover misinformation signals and investigate the evidence.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-wrap items-center gap-4 pt-2"
            >
              <Link
                to={user ? '/analyze' : '/register'}
                className="inline-flex items-center gap-2.5 px-6 py-3.5 text-xs sm:text-sm font-bold tracking-wide text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <span>START ANALYSING</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#technology"
                className="inline-flex items-center gap-2 px-5 py-3.5 text-xs sm:text-sm font-semibold tracking-wide text-[#F3F5F7] bg-[#101522] hover:bg-[#161D2B] border border-white/15 rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <span>EXPLORE TECHNOLOGY</span>
              </a>
            </motion.div>

            <div className="pt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#929BAD] font-mono">
              <span>Explainable TF-IDF & Linear Classifiers</span>
              <span aria-hidden="true">·</span>
              <span>Separate Source Intelligence</span>
              <span aria-hidden="true">·</span>
              <span>PDF Dossier Export</span>
            </div>
          </div>

          <div className="lg:col-span-6 flex">
            <HeroIntelligenceVisual
              activeModelName={modelMetrics.active_model?.model_name}
              activeModelVersion={modelMetrics.active_model?.version}
              onSelectFragment={handleSelectHeroFragment}
            />
          </div>
        </div>
      </section>

      {/* 3. Live Animated News Analysis Demonstration */}
      <section id="live-demo" className="max-w-7xl mx-auto px-6 py-20 border-b border-white/10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
          <div>
            <p className="text-xs font-mono text-[#28DFFF] mb-2">Interactive Live Inference</p>
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7]">
              Inspect Real Classifier Behavior
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {DEMO_SAMPLES.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => {
                  setDemoText(sample.text);
                  runLiveDemo(sample.text);
                }}
                className="px-3.5 py-2 text-xs font-medium text-[#F3F5F7] bg-[#101522] hover:bg-[#161D2B] border border-white/12 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 bg-[#101522]/90 border border-white/12 rounded-2xl p-6 space-y-4">
            <label htmlFor="demo-input" className="block text-xs font-medium text-[#929BAD]">
              News Headline or Excerpt
            </label>
            <textarea
              id="demo-input"
              rows={6}
              value={demoText}
              onChange={(e) => setDemoText(e.target.value)}
              className="w-full bg-[#080B12] border border-white/15 rounded-xl p-4 text-sm text-[#F3F5F7] placeholder:text-[#929BAD]/60 focus:outline-none focus:border-[#28DFFF]"
              placeholder="Paste a news headline or paragraph to inspect live model scoring..."
            />
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-mono text-[#929BAD]">
                {demoText.length} characters
              </span>
              <button
                type="button"
                disabled={demoLoading || demoText.trim().length < 20}
                onClick={() => runLiveDemo(demoText)}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <ScanSearch className="w-4 h-4" />
                <span>{demoLoading ? 'Running Model...' : 'Run Live Analysis'}</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 bg-[#101522]/90 border border-white/12 rounded-2xl p-6 flex flex-col justify-between space-y-5">
            {demoError ? (
              <div className="p-4 rounded-xl bg-[#FF647C]/12 border border-[#FF647C]/30 text-xs text-[#FFB3BF]">
                {demoError}
              </div>
            ) : demoResult ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                  <div className="space-y-2">
                    <p className="text-xs text-[#929BAD]">Model Classification</p>
                    <PredictionBadge prediction={demoResult.prediction} size="lg" />
                    <p className="text-[11px] font-mono text-[#929BAD]">
                      {demoResult.model_name} · {demoResult.model_version}
                    </p>
                  </div>
                  <ConfidenceGauge
                    confidence={demoResult.confidence}
                    prediction={demoResult.prediction}
                    size={122}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#C6FF4D]">
                      REAL {(demoResult.prob_real * 100).toFixed(1)}%
                    </span>
                    <span className="text-[#FF647C]">
                      FAKE {(demoResult.prob_fake * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 bg-[#080B12] rounded-full overflow-hidden flex border border-white/10">
                    <div
                      style={{ width: `${(demoResult.prob_real * 100).toFixed(1)}%` }}
                      className="bg-[#C6FF4D] transition-all duration-500"
                    />
                    <div
                      style={{ width: `${(demoResult.prob_fake * 100).toFixed(1)}%` }}
                      className="bg-[#FF647C] transition-all duration-500"
                    />
                  </div>
                </div>

                <p className="text-xs text-[#F3F5F7]/85 leading-relaxed">
                  {demoResult.explanation_summary}
                </p>

                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/10 text-xs">
                  <div>
                    <p className="text-[#FF647C] font-medium mb-1">Top FAKE Signals</p>
                    <p className="text-[#929BAD] font-mono truncate">
                      {demoResult.top_fake_features.slice(0, 3).map((f) => f.term).join(', ') || 'None'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#C6FF4D] font-medium mb-1">Top REAL Signals</p>
                    <p className="text-[#929BAD] font-mono truncate">
                      {demoResult.top_real_features.slice(0, 3).map((f) => f.term).join(', ') || 'None'}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-[#929BAD]">Initializing active model demonstration...</p>
            )}
          </div>
        </div>
      </section>

      {/* 4. Asymmetric Feature Showcase */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-20 border-b border-white/10">
        <div className="max-w-2xl mb-12">
          <p className="text-xs font-mono text-[#28DFFF] mb-2">Platform Capabilities</p>
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7]">
            Built for Auditable News Intelligence
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            className="md:col-span-2 bg-[#101522]/85 border border-white/10 rounded-2xl p-6 space-y-3"
          >
            <Sparkles className="w-5 h-5 text-[#28DFFF]" />
            <h3 className="text-lg font-display font-semibold text-[#F3F5F7]">
              Explainable Feature Attribution
            </h3>
            <p className="text-sm text-[#929BAD] leading-relaxed">
              Every classification exposes the exact TF-IDF unigrams and bigrams driving the prediction score, displaying signed feature weights, vocabulary coverage, and inline color-coded token highlights.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ delay: 0.05 }}
            className="bg-[#101522]/85 border border-white/10 rounded-2xl p-6 space-y-3"
          >
            <Scale className="w-5 h-5 text-[#9566FF]" />
            <h3 className="text-lg font-display font-semibold text-[#F3F5F7]">
              Uncertainty Guardrails
            </h3>
            <p className="text-sm text-[#929BAD] leading-relaxed">
              Low-confidence predictions or sparse inputs are routed to UNCERTAIN instead of forcing brittle binary verdicts.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ delay: 0.08 }}
            className="bg-[#101522]/85 border border-white/10 rounded-2xl p-6 space-y-3"
          >
            <Globe2 className="w-5 h-5 text-[#C6FF4D]" />
            <h3 className="text-lg font-display font-semibold text-[#F3F5F7]">
              SSRF-Safe URL Extraction
            </h3>
            <p className="text-sm text-[#929BAD] leading-relaxed">
              Server-side extraction strips HTML boilerplate, enforces private-IP SSRF checks, and inspects publisher transparency separately from text ML.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ delay: 0.12 }}
            className="md:col-span-2 bg-[#101522]/85 border border-white/10 rounded-2xl p-6 space-y-3"
          >
            <FileText className="w-5 h-5 text-[#9566FF]" />
            <h3 className="text-lg font-display font-semibold text-[#F3F5F7]">
              Independent Fact Verification & PDF Dossiers
            </h3>
            <p className="text-sm text-[#929BAD] leading-relaxed">
              Supporting and contradicting evidence references are investigated separately from model probabilities, stored in analysis history, and exported as structured PDF reports.
            </p>
          </motion.div>
        </div>
      </section>

      {/* 5. Four-Stage Workflow */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-6 py-20 border-b border-white/10">
        <div className="max-w-2xl mb-12">
          <p className="text-xs font-mono text-[#28DFFF] mb-2">Verification Pipeline</p>
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7]">
            Four-Stage Analysis Workflow
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              step: '01. Input & Extraction',
              desc: 'Submit a headline, full article text, or public news URL. Boilerplate is stripped and metadata extracted.',
            },
            {
              step: '02. Text Preprocessing',
              desc: 'Normalization, year-preserving tokenization, stopword filtering, and n-gram TF-IDF vectorization.',
            },
            {
              step: '03. Calibrated Inference',
              desc: 'The active trained classifier outputs calibrated probabilities, enforces threshold guardrails, and attributes weights.',
            },
            {
              step: '04. Evidence & Reporting',
              desc: 'Source intelligence and independent fact-check references attach separately, saved to history and exportable to PDF.',
            },
          ].map((item, idx) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ delay: idx * 0.06 }}
              className="bg-[#101522]/75 border border-white/10 rounded-2xl p-6 space-y-2.5"
            >
              <h3 className="text-base font-display font-semibold text-[#F3F5F7]">{item.step}</h3>
              <p className="text-sm text-[#929BAD] leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* 6. Machine Learning Technology */}
      <section id="technology" className="max-w-7xl mx-auto px-6 py-20 border-b border-white/10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-5">
            <div className="h-full min-h-[280px] rounded-2xl overflow-hidden border border-white/10 bg-[#101522]">
              {!techImgFailed ? (
                <img
                  src="/src/assets/images/tech_neural_pipeline_1794927781880.jpg"
                  alt="Isometric multi-layer NLP classification architecture"
                  referrerPolicy="no-referrer"
                  onError={() => setTechImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center p-8">
                  <Layers className="w-12 h-12 text-[#9566FF]" />
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
            <div>
              <p className="text-xs font-mono text-[#9566FF] mb-2">Machine Learning Stack</p>
              <h2 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7]">
                Leakage-Free Training & Versioned Artifacts
              </h2>
            </div>

            <p className="text-sm text-[#929BAD] leading-relaxed">
              Administrators upload WELFake, ISOT, or LIAR CSV corpora, inspect deduplication and missing-value statistics, train multiple algorithms side by side with stratified cross-validation, and activate validated models only after reviewing held-out metrics.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              {[
                { name: 'TF-IDF + Logistic Regression', detail: 'L2-regularized probability calibration & coefficient attribution' },
                { name: 'TF-IDF + Multinomial Naive Bayes', detail: 'Laplace-smoothed log-likelihood ratios over n-grams' },
                { name: 'TF-IDF + Linear SVM', detail: 'Hinge-loss margin classifier with Platt sigmoid scaling' },
                { name: 'DistilBERT Transformer (Python)', detail: 'Optional HuggingFace fine-tuning pipeline in /backend' },
              ].map((m) => (
                <div key={m.name} className="p-4 rounded-xl bg-[#101522]/90 border border-white/10">
                  <p className="font-semibold text-[#F3F5F7] text-sm mb-1">{m.name}</p>
                  <p className="text-xs text-[#929BAD]">{m.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 7. Actual Model Performance Metrics */}
      <section id="performance" className="max-w-7xl mx-auto px-6 py-20 border-b border-white/10">
        <div className="max-w-2xl mb-10">
          <p className="text-xs font-mono text-[#28DFFF] mb-2">Held-Out Evaluation Metrics</p>
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7]">
            Verified Benchmarks From Trained Artifacts
          </h2>
          <p className="text-sm text-[#929BAD] mt-2">
            Every metric below is computed directly on held-out stratified test splits stored in the active model registry.
          </p>
        </div>

        {modelMetrics.models.length === 0 ? (
          <div className="p-6 rounded-2xl bg-[#101522]/80 border border-white/10 text-sm text-[#929BAD]">
            No trained model evaluations found yet. Sign in as administrator to train and evaluate models.
          </div>
        ) : (
          <div className="overflow-x-auto bg-[#101522]/90 border border-white/12 rounded-2xl">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-[#929BAD] font-mono">
                  <th className="py-3.5 px-5">Model</th>
                  <th className="py-3.5 px-4">Version</th>
                  <th className="py-3.5 px-4 text-right">Accuracy</th>
                  <th className="py-3.5 px-4 text-right">Precision</th>
                  <th className="py-3.5 px-4 text-right">Recall</th>
                  <th className="py-3.5 px-4 text-right">F1-Score</th>
                  <th className="py-3.5 px-4 text-right">ROC-AUC</th>
                  <th className="py-3.5 px-5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {modelMetrics.models.map((m) => (
                  <tr key={m.id} className="hover:bg-white/[0.02]">
                    <td className="py-3.5 px-5 font-medium text-[#F3F5F7]">{m.model_name}</td>
                    <td className="py-3.5 px-4 font-mono text-xs text-[#929BAD]">{m.version}</td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#F3F5F7]">
                      {(m.accuracy * 100).toFixed(1)}%
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#F3F5F7]">
                      {(m.precision_score * 100).toFixed(1)}%
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#F3F5F7]">
                      {(m.recall_score * 100).toFixed(1)}%
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#C6FF4D]">
                      {(m.f1_score * 100).toFixed(1)}%
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#28DFFF]">
                      {m.roc_auc.toFixed(3)}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono text-xs">
                      <span className={m.status === 'active' ? 'text-[#C6FF4D] font-semibold' : 'text-[#929BAD]'}>
                        {m.status === 'active' ? 'Active' : 'Trained'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 8. Use Cases */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-b border-white/10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: CheckCircle2,
              title: 'Academic NLP Research',
              desc: 'Benchmark TF-IDF pipelines against WELFake, ISOT, or LIAR splits with reproducible seeds and confusion matrices.',
            },
            {
              icon: Cpu,
              title: 'Newsroom Triage',
              desc: 'Inspect suspicious viral headlines, extract publisher metadata, and export auditable PDF dossiers.',
            },
            {
              icon: Shield,
              title: 'Media Literacy Education',
              desc: 'Demonstrate how sensational phrasing differs from institutional reporting without overclaiming truth certainty.',
            },
          ].map((u) => {
            const Icon = u.icon;
            return (
              <div
                key={u.title}
                className="bg-[#101522]/75 border border-white/10 rounded-2xl p-6 space-y-2.5"
              >
                <Icon className="w-5 h-5 text-[#28DFFF]" />
                <h3 className="text-base font-display font-semibold text-[#F3F5F7]">{u.title}</h3>
                <p className="text-sm text-[#929BAD] leading-relaxed">{u.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 9. FAQ */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7] mb-8 text-center">
          Frequently Asked Questions
        </h2>
        <div className="space-y-3">
          {FAQS.map((item, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={item.q}
                className="bg-[#101522]/85 border border-white/10 rounded-2xl overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="w-full px-6 py-4 text-left flex items-center justify-between gap-4 cursor-pointer"
                >
                  <span className="text-sm font-semibold text-[#F3F5F7]">{item.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-[#929BAD] shrink-0 transition-transform ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-6 pb-5 text-sm text-[#929BAD] leading-relaxed border-t border-white/8 pt-3">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 10. Quiet Footer */}
      <footer className="border-t border-white/10 bg-[#080B12]">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#929BAD]">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#28DFFF]" />
            <span className="font-semibold text-[#F3F5F7]">TRUTHLENS AI</span>
            <span aria-hidden="true">·</span>
            <span>See Beyond The Headline</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="hover:text-[#F3F5F7] transition-colors">
              Features
            </a>
            <a href="#performance" className="hover:text-[#F3F5F7] transition-colors">
              Benchmarks
            </a>
            <Link to="/login" className="hover:text-[#F3F5F7] transition-colors">
              Sign In
            </Link>
            <Link to="/register" className="hover:text-[#F3F5F7] transition-colors">
              Start Analysing
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

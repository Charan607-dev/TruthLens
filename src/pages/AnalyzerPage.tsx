import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Eraser,
  FileText,
  Globe,
  Heading,
  Link2,
  Loader2,
  ScanSearch,
  SearchCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { AnalysisResultView } from '../components/AnalysisResultView';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { apiRequest } from '../lib/api';
import { AnalysisResponse, SourceCredibilityReport } from '../types';

type InputMode = 'headline' | 'article' | 'url';

interface ModelInfoStatus {
  trained: boolean;
  model_name?: string;
  version?: string;
  message?: string;
}

interface ExtractedUrlPreview {
  extracted: {
    url: string;
    domain: string;
    title: string;
    body: string;
    author: string | null;
    published_date: string | null;
    site_name: string | null;
    word_count: number;
  };
  source_credibility: SourceCredibilityReport;
}

const PROCESSING_STEPS = [
  { key: 'read', label: 'Reading article & validating submission' },
  { key: 'norm', label: 'Normalizing & tokenizing text pipeline' },
  { key: 'tfidf', label: 'Extracting TF-IDF linguistic features' },
  { key: 'model', label: 'Running trained classifier & probability calibration' },
  { key: 'prep', label: 'Preparing explainability & verification report' },
];

export function AnalyzerPage() {
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<InputMode>('headline');
  const [headline, setHeadline] = useState('');
  const [articleText, setArticleText] = useState('');
  const [optionalSourceUrl, setOptionalSourceUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [urlPreview, setUrlPreview] = useState<ExtractedUrlPreview | null>(null);
  const [extractingUrl, setExtractingUrl] = useState(false);

  const [threshold, setThreshold] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('truthlens_default_threshold'));
      if (!Number.isNaN(saved) && saved >= 0.5 && saved <= 0.85) return saved;
    } catch {
      // ignore storage restrictions
    }
    return 0.62;
  });
  const [runFactCheck, setRunFactCheck] = useState(false);
  const [modelInfo, setModelInfo] = useState<ModelInfoStatus | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  useEffect(() => {
    apiRequest<ModelInfoStatus>('/api/model/info')
      .then(setModelInfo)
      .catch((err) =>
        setModelInfo({
          trained: false,
          message:
            err instanceof Error
              ? err.message
              : 'Unable to reach TruthLens ML backend to verify model status.',
        })
      );
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setArticleText(text);
    } catch {
      setError('Clipboard read permission blocked by browser. Paste directly with Ctrl/Cmd+V.');
    }
  };

  const handleClearArticle = () => {
    setHeadline('');
    setArticleText('');
    setOptionalSourceUrl('');
    setError(null);
  };

  const handleExtractUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setUrlPreview(null);
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) {
      setError('Please enter a public http:// or https:// news article URL.');
      return;
    }
    setExtractingUrl(true);
    try {
      const data = await apiRequest<ExtractedUrlPreview>('/api/analyze-url', {
        method: 'POST',
        body: JSON.stringify({ url: trimmedUrl, preview_only: true }),
      });
      setUrlPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract URL content.');
    } finally {
      setExtractingUrl(false);
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (modelInfo && !modelInfo.trained) {
      setError(
        modelInfo.message ||
          'Model not trained or backend unreachable. Predictions are disabled until an active trained model responds.'
      );
      return;
    }

    if (mode === 'headline' && headline.trim().length < 12) {
      setError('Headline must be at least 12 characters long for reliable classification.');
      return;
    }
    if (mode === 'article' && articleText.trim().length < 40) {
      setError('Complete article text must be at least 40 characters long.');
      return;
    }
    if (mode === 'url' && !urlPreview && !urlInput.trim()) {
      setError('Enter a valid public news URL or fetch article preview before analysing.');
      return;
    }

    setAnalyzing(true);
    setActiveStep(0);

    const t1 = window.setTimeout(() => setActiveStep((s) => Math.max(s, 1)), 120);
    const t2 = window.setTimeout(() => setActiveStep((s) => Math.max(s, 2)), 260);
    const t3 = window.setTimeout(() => setActiveStep((s) => Math.max(s, 3)), 420);

    try {
      let data: AnalysisResponse;
      if (mode === 'url') {
        if (urlPreview && urlPreview.extracted.url === urlInput.trim()) {
          data = await apiRequest<AnalysisResponse>('/api/analyze', {
            method: 'POST',
            body: JSON.stringify({
              mode: 'url',
              headline: urlPreview.extracted.title,
              article_text: urlPreview.extracted.body,
              source_url: urlPreview.extracted.url,
              author: urlPreview.extracted.author,
              published_date: urlPreview.extracted.published_date,
              uncertainty_threshold: threshold,
              run_fact_check: runFactCheck,
            }),
          });
        } else {
          // Allow direct 1-click URL extraction + classification via /api/analyze-url
          data = await apiRequest<AnalysisResponse>('/api/analyze-url', {
            method: 'POST',
            body: JSON.stringify({
              url: urlInput.trim(),
              preview_only: false,
              uncertainty_threshold: threshold,
              run_fact_check: runFactCheck,
            }),
          });
        }
      } else {
        data = await apiRequest<AnalysisResponse>('/api/analyze', {
          method: 'POST',
          body: JSON.stringify({
            mode,
            headline: headline.trim(),
            article_text: articleText.trim(),
            source_url: optionalSourceUrl.trim() || null,
            uncertainty_threshold: threshold,
            run_fact_check: runFactCheck,
          }),
        });
      }

      setActiveStep(4);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      setAnalyzing(false);
    }
  };

  const wordCount = articleText.trim() ? articleText.trim().split(/\s+/).length : 0;

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-mono text-[#28DFFF]">Verification Engine</p>
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-[#F3F5F7]">
              AI News Analyzer
            </h1>
            <p className="text-sm text-[#929BAD]">
              Inspect headlines, complete articles, or live public URLs with real-time feature attribution.
            </p>
          </div>
          {modelInfo && (
            <div className="text-xs font-mono text-[#929BAD] bg-[#101522] border border-white/10 px-4 py-2 rounded-xl whitespace-nowrap shrink-0">
              {modelInfo.trained ? (
                <span>
                  Active:{' '}
                  <span className="text-[#C6FF4D]">{modelInfo.model_name}</span> (
                  {modelInfo.version})
                </span>
              ) : (
                <span className="text-[#FF647C]">Model unavailable</span>
              )}
            </div>
          )}
        </div>

        {modelInfo && !modelInfo.trained && (
          <div className="p-4 rounded-xl bg-[#FF647C]/10 border border-[#FF647C]/30 flex items-start gap-3 text-sm text-[#FFB3BF]">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Backend / Model Status Notice</p>
              <p className="text-xs opacity-85 mt-0.5">
                {modelInfo.message ||
                  'Production predictions are disabled until an administrator trains and activates a model.'}
              </p>
            </div>
          </div>
        )}

        {/* Animated Segmented Mode Tabs */}
        <div className="flex flex-wrap p-1.5 bg-[#101522] border border-white/10 rounded-2xl gap-1.5 w-fit">
          {[
            { id: 'headline' as const, label: 'Headline Analysis', icon: Heading },
            { id: 'article' as const, label: 'Full Article Analysis', icon: FileText },
            { id: 'url' as const, label: 'URL Analysis', icon: Globe },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = mode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setMode(tab.id);
                  setError(null);
                }}
                className={`relative inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active ? 'text-[#080B12]' : 'text-[#929BAD] hover:text-[#F3F5F7]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="analyzerModePill"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="absolute inset-0 bg-[#C6FF4D] rounded-xl"
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Centerpiece Input Workspace */}
        <div className="bg-[#101522]/90 border border-white/12 rounded-2xl p-6 sm:p-7 space-y-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          {mode === 'url' && (
            <div className="space-y-5">
              <form onSubmit={handleExtractUrl} noValidate className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Link2 className="w-4 h-4 text-[#28DFFF] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="url"
                    required
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (urlPreview && e.target.value.trim() !== urlPreview.extracted.url) {
                        setUrlPreview(null);
                      }
                      if (error) setError(null);
                    }}
                    placeholder="https://www.reuters.com/world/..."
                    className="w-full bg-[#080B12] border border-white/15 rounded-xl pl-11 pr-4 py-3 text-sm text-[#F3F5F7] placeholder:text-[#929BAD]/60 focus:outline-none focus:border-[#28DFFF] transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={extractingUrl || !urlInput.trim()}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 text-xs font-semibold bg-[#161D2B] hover:bg-white/10 text-[#F3F5F7] border border-white/15 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {extractingUrl ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#28DFFF]" />
                      <span>Fetching Article...</span>
                    </>
                  ) : (
                    <span>Fetch Article</span>
                  )}
                </button>
              </form>

              {urlPreview && (
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-5 rounded-xl bg-[#080B12]/80 border border-[#28DFFF]/30 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#929BAD]">
                    <span className="text-[#28DFFF]">{urlPreview.extracted.domain}</span>
                    <span>
                      {urlPreview.extracted.word_count} words · Author:{' '}
                      {urlPreview.extracted.author || 'Unknown'} · Date:{' '}
                      {urlPreview.extracted.published_date || 'Unknown'}
                    </span>
                  </div>
                  <h3 className="text-base font-display font-semibold text-[#F3F5F7]">
                    {urlPreview.extracted.title}
                  </h3>
                  <p className="text-xs text-[#929BAD] leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap">
                    {urlPreview.extracted.body}
                  </p>
                </motion.div>
              )}
            </div>
          )}

          <form onSubmit={handleAnalyze} noValidate className="space-y-5">
            {mode === 'headline' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[#F3F5F7]">
                    News Headline to Examine *
                  </label>
                  <span className="text-xs font-mono text-[#929BAD]">
                    {headline.length} characters
                  </span>
                </div>
                <input
                  type="text"
                  required
                  value={headline}
                  onChange={(e) => {
                    setHeadline(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Enter a news headline (e.g., NASA Apollo 11 astronauts landed on the Moon on July 20, 1969)..."
                  className="w-full bg-[#080B12] border border-white/15 rounded-xl px-4 py-4 text-base sm:text-lg font-display text-[#F3F5F7] placeholder:text-[#929BAD]/55 focus:outline-none focus:border-[#28DFFF] focus:ring-2 focus:ring-[#28DFFF]/20 transition-all"
                />
              </div>
            )}

            {mode === 'article' && (
              <>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[#929BAD]">
                    Article Headline (Optional)
                  </label>
                  <input
                    type="text"
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    placeholder="Optional headline context..."
                    className="w-full bg-[#080B12] border border-white/15 rounded-xl px-4 py-2.5 text-sm text-[#F3F5F7] placeholder:text-[#929BAD]/60 focus:outline-none focus:border-[#28DFFF]"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-medium text-[#F3F5F7]">
                      Complete Article Body *
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handlePaste}
                        className="inline-flex items-center gap-1.5 text-xs text-[#28DFFF] hover:underline cursor-pointer"
                      >
                        <ClipboardPaste className="w-3.5 h-3.5" />
                        <span>Paste Article</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleClearArticle}
                        className="inline-flex items-center gap-1.5 text-xs text-[#929BAD] hover:text-[#FF647C] cursor-pointer"
                      >
                        <Eraser className="w-3.5 h-3.5" />
                        <span>Clear Text</span>
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={8}
                    required
                    value={articleText}
                    onChange={(e) => {
                      setArticleText(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Paste the complete article body here (minimum 40 characters)..."
                    className="w-full bg-[#080B12] border border-white/15 rounded-xl p-4 text-sm text-[#F3F5F7] placeholder:text-[#929BAD]/60 focus:outline-none focus:border-[#28DFFF] focus:ring-2 focus:ring-[#28DFFF]/20 transition-all"
                  />
                  <div className="flex flex-wrap items-center justify-between text-xs font-mono text-[#929BAD]">
                    <span>
                      {articleText.length} characters · {wordCount} words
                    </span>
                    <span>Matches training pipeline preprocessing</span>
                  </div>
                </div>
              </>
            )}

            {mode !== 'url' && (
              <div>
                <label className="block text-xs font-medium text-[#929BAD] mb-1.5">
                  Publisher Source URL (Optional — inspected separately by Source Intelligence)
                </label>
                <input
                  type="url"
                  value={optionalSourceUrl}
                  onChange={(e) => setOptionalSourceUrl(e.target.value)}
                  placeholder="https://example.com/news-story"
                  className="w-full bg-[#080B12] border border-white/15 rounded-xl px-4 py-2.5 text-sm text-[#F3F5F7] placeholder:text-[#929BAD]/60 focus:outline-none focus:border-[#28DFFF]"
                />
              </div>
            )}

            {/* Analysis Settings Row */}
            <div className="pt-5 border-t border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-3">
                  <SlidersHorizontal className="w-4 h-4 text-[#28DFFF]" />
                  <label htmlFor="threshold-slider" className="text-xs text-[#F3F5F7] whitespace-nowrap">
                    Uncertainty Threshold:{' '}
                    <span className="font-mono font-semibold text-[#28DFFF]">
                      {(threshold * 100).toFixed(0)}%
                    </span>
                  </label>
                  <input
                    id="threshold-slider"
                    type="range"
                    min={0.5}
                    max={0.85}
                    step={0.02}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-28 accent-[#28DFFF] cursor-pointer"
                  />
                </div>

                <label className="inline-flex items-center gap-2.5 text-xs text-[#F3F5F7] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={runFactCheck}
                    onChange={(e) => setRunFactCheck(e.target.checked)}
                    className="rounded border-white/20 accent-[#9566FF]"
                  />
                  <SearchCheck className="w-4 h-4 text-[#9566FF]" />
                  <span>Query independent fact-check references</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={
                  analyzing ||
                  (modelInfo !== null && !modelInfo.trained) ||
                  (mode === 'url' && !urlPreview && !urlInput.trim())
                }
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-xs sm:text-sm font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Running Classification...</span>
                  </>
                ) : (
                  <>
                    <ScanSearch className="w-4 h-4" />
                    <span>
                      {mode === 'url'
                        ? urlPreview
                          ? 'Analyse Extracted Content'
                          : 'Fetch & Analyse URL'
                        : 'Analyse News'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </form>

          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-[#FF647C]/12 border border-[#FF647C]/30 text-xs text-[#FFB3BF]"
            >
              {error}
            </div>
          )}
        </div>

        {/* Live Pipeline Stage Indicator */}
        {analyzing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-[#101522]/90 border border-[#28DFFF]/35 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between text-xs font-mono text-[#28DFFF]">
              <span>{PROCESSING_STEPS[activeStep]?.label}</span>
              <span>{Math.round(((activeStep + 1) / PROCESSING_STEPS.length) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-[#080B12] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#28DFFF] via-[#9566FF] to-[#C6FF4D] transition-all duration-200"
                style={{
                  width: `${Math.round(((activeStep + 1) / PROCESSING_STEPS.length) * 100)}%`,
                }}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-1">
              {PROCESSING_STEPS.map((st, idx) => {
                const done = idx < activeStep;
                const current = idx === activeStep;
                return (
                  <div
                    key={st.key}
                    className={`flex items-center gap-1.5 text-[11px] font-mono ${
                      done
                        ? 'text-[#C6FF4D]'
                        : current
                          ? 'text-[#28DFFF]'
                          : 'text-[#929BAD]/60'
                    }`}
                  >
                    {done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    ) : current ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border border-white/15 shrink-0" />
                    )}
                    <span className="truncate">{st.key.toUpperCase()}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Cinematic Result Reveal */}
        {result && !analyzing && <AnalysisResultView analysis={result} />}
      </div>
    </WorkspaceLayout>
  );
}

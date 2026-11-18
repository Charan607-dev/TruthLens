import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe2,
  HelpCircle,
  Info,
  MessageSquarePlus,
  Scale,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { generateAnalysisPdfReport } from '../lib/pdfExport';
import {
  formatProbabilityPct,
  formatRawProbabilityPct,
  formatThresholdPct,
} from '../lib/probability';
import { AnalysisResponse } from '../types';
import { ConfidenceGauge } from './ConfidenceGauge';
import { HighlightedText } from './HighlightedText';
import { PredictionBadge } from './PredictionBadge';

interface Props {
  analysis: AnalysisResponse;
}

export function AnalysisResultView({ analysis }: Props) {
  const reducedMotion = useReducedMotion();
  const [feedbackType, setFeedbackType] = useState('incorrect_prediction');
  const [rating, setRating] = useState<number>(4);
  const [comments, setComments] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const { ml_result: ml, source_credibility: source } = analysis;
  const rawProbReal = ml.decision_debug?.prob_real_raw ?? ml.prob_real;
  const rawProbFake = ml.decision_debug?.prob_fake_raw ?? ml.prob_fake;
  const rawComparedProb = ml.decision_debug?.compared_probability_raw ?? Math.max(rawProbReal, rawProbFake);
  const rawThreshold = ml.decision_debug?.threshold_raw ?? ml.uncertainty_threshold;
  const refs = analysis.fact_check?.references || analysis.verification_sources || [];
  const factCheckReason = analysis.fact_check?.reason;
  const extractedClaims = analysis.fact_check?.extracted_claims || [];

  const supportingRefs = refs.filter((r) => r.stance === 'supporting');
  const challengingRefs = refs.filter((r) => r.stance !== 'supporting');

  const verdictTheme = {
    REAL: {
      border: 'border-[#C6FF4D]/30',
      aura: 'radial-gradient(circle at 12% 0%, rgba(198,255,77,0.12), transparent 55%)',
      headlineNote: 'ML Classification: Aligned With Factual / Institutional Reporting Patterns',
      icon: CheckCircle2,
      iconColor: 'text-[#C6FF4D]',
    },
    FAKE: {
      border: 'border-[#FF647C]/35',
      aura: 'radial-gradient(circle at 12% 0%, rgba(255,100,124,0.14), transparent 55%)',
      headlineNote: 'ML Warning: Strong Correlation With Misleading or Fabricated Corpus Patterns',
      icon: AlertTriangle,
      iconColor: 'text-[#FF647C]',
    },
    UNCERTAIN: {
      border: 'border-[#9566FF]/35',
      aura: 'radial-gradient(circle at 12% 0%, rgba(149,102,255,0.15), transparent 55%)',
      headlineNote: 'Ambiguity Guardrail: Confidence Below Configured Uncertainty Threshold',
      icon: HelpCircle,
      iconColor: 'text-[#C4A8FF]',
    },
  }[ml.prediction];

  const VerdictIcon = verdictTheme.icon;

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingFeedback(true);
    setFeedbackStatus(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          analysis_id: analysis.id,
          feedback_type: feedbackType,
          rating,
          comments,
          reference_url: referenceUrl || null,
        }),
      });
      setFeedbackStatus({ ok: true, msg: res.message });
      setComments('');
      setReferenceUrl('');
    } catch (err) {
      setFeedbackStatus({
        ok: false,
        msg: err instanceof Error ? err.message : 'Unable to submit feedback.',
      });
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-6"
    >
      {/* 1. Cinematic Verdict & Probability Gauge */}
      <div
        className={`relative overflow-hidden bg-[#101522]/90 border ${verdictTheme.border} rounded-2xl p-6 sm:p-7`}
        style={{ backgroundImage: verdictTheme.aura }}
      >
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5 pb-6 border-b border-white/10">
          <div className="space-y-2.5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono text-[#929BAD]">
              <VerdictIcon className={`w-4 h-4 ${verdictTheme.iconColor}`} />
              <span className="text-[#F3F5F7]">{verdictTheme.headlineNote}</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-display font-bold text-[#F3F5F7] leading-snug">
              {analysis.headline || 'Article Verification Dossier'}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono text-[#929BAD]">
              <span>{ml.model_name}</span>
              <span aria-hidden="true">·</span>
              <span>{ml.model_version}</span>
              <span aria-hidden="true">·</span>
              <span>Threshold {formatThresholdPct(rawThreshold)}</span>
              <span aria-hidden="true">·</span>
              <span>{new Date(analysis.created_at).toLocaleString()}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <PredictionBadge prediction={ml.prediction} size="lg" />
            <button
              type="button"
              onClick={() => generateAnalysisPdfReport(analysis)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export PDF Report</span>
            </button>
          </div>
        </div>

        {/* Confidence Gauge + Probability Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center pt-6">
          <div className="md:col-span-4 lg:col-span-3 flex justify-center md:justify-start">
            <ConfidenceGauge
              confidence={rawComparedProb}
              prediction={ml.prediction}
              threshold={rawThreshold}
              size={156}
            />
          </div>

          <div className="md:col-span-8 lg:col-span-9 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[#C6FF4D]">
                  REAL Class Probability: {formatProbabilityPct(rawProbReal, rawThreshold)}
                </span>
                <span className="text-[#FF647C]">
                  FAKE Class Probability: {formatProbabilityPct(rawProbFake, rawThreshold)}
                </span>
              </div>
              <div className="h-3 w-full bg-[#080B12] rounded-full overflow-hidden flex border border-white/10 p-0.5">
                <motion.div
                  initial={reducedMotion ? false : { width: 0 }}
                  animate={{ width: `${(rawProbReal * 100).toFixed(4)}%` }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-[#C6FF4D] rounded-l-full"
                />
                <motion.div
                  initial={reducedMotion ? false : { width: 0 }}
                  animate={{ width: `${(rawProbFake * 100).toFixed(4)}%` }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-[#FF647C] rounded-r-full"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#929BAD] bg-[#080B12]/65 border border-white/8 rounded-lg px-3 py-1.5">
                <span>
                  Unrounded: P(REAL)={formatRawProbabilityPct(rawProbReal)} · P(FAKE)={formatRawProbabilityPct(rawProbFake)}
                </span>
                <span>
                  Threshold Check: {formatRawProbabilityPct(rawComparedProb)}{' '}
                  {ml.prediction === 'UNCERTAIN' ? '<' : '>='}{' '}
                  {formatThresholdPct(rawThreshold)} → <strong className="text-[#F3F5F7]">{ml.prediction}</strong>
                </span>
              </div>
            </div>

            <p className="text-sm text-[#F3F5F7]/90 leading-relaxed">
              {ml.explanation_summary}
            </p>

            {/* Quick Workspace Deep-Dive Links */}
            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs font-medium">
              <Link
                to={`/explainability?id=${analysis.id}`}
                className="inline-flex items-center gap-1 text-[#28DFFF] hover:underline"
              >
                <span>Open Explainability View</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
              <Link
                to={`/sources?id=${analysis.id}`}
                className="inline-flex items-center gap-1 text-[#28DFFF] hover:underline"
              >
                <span>Inspect Source Profile</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
              <Link
                to={`/verification?id=${analysis.id}`}
                className="inline-flex items-center gap-1 text-[#9566FF] hover:underline"
              >
                <span>Fact Verification Workspace</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>

        {/* Non-Proof Epistemic Boundary Disclaimer */}
        <div className="mt-6 p-4 rounded-xl bg-[#080B12]/75 border border-white/10 flex items-start gap-3">
          <Info className="w-4 h-4 text-[#28DFFF] shrink-0 mt-0.5" />
          <p className="text-xs text-[#929BAD] leading-relaxed">
            <span className="text-[#F3F5F7] font-medium">
              Model prediction is based on learned text patterns and does not independently establish factual truth.
            </span>{' '}
            ({ml.matched_features_count} matched TF-IDF features across {ml.total_tokens} tokens
            {ml.vocabulary_coverage !== undefined
              ? ` · ${(ml.vocabulary_coverage * 100).toFixed(0)}% unigram vocabulary coverage`
              : ''}
            .)
          </p>
        </div>
      </div>

      {/* 2. Explainable AI Attribution & Highlighted Article */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-display font-semibold text-[#F3F5F7] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#28DFFF]" />
              <span>Feature Attribution</span>
            </h3>
            <span className="text-xs font-mono text-[#929BAD]">
              {ml.matched_features_count} features
              {ml.vocabulary_coverage !== undefined
                ? ` · ${(ml.vocabulary_coverage * 100).toFixed(0)}% cov`
                : ''}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium text-[#FF647C] mb-2.5">
                Signals Correlated With FAKE Class
              </p>
              {ml.top_fake_features.length === 0 ? (
                <p className="text-xs text-[#929BAD]">No strong fake-correlated terms detected.</p>
              ) : (
                <div className="space-y-2.5">
                  {ml.top_fake_features.slice(0, 6).map((f) => (
                    <div key={`fake-${f.term}`} className="space-y-1">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-[#F3F5F7] truncate max-w-[180px]">{f.term}</span>
                        <span className="text-[#FF647C]">+{f.contribution.toFixed(4)}</span>
                      </div>
                      <div className="h-1.5 bg-[#080B12] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#FF647C] rounded-full"
                          style={{
                            width: `${Math.min(100, Math.max(8, Math.abs(f.contribution) * 200))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-white/10">
              <p className="text-xs font-medium text-[#C6FF4D] mb-2.5">
                Signals Correlated With REAL Class
              </p>
              {ml.top_real_features.length === 0 ? (
                <p className="text-xs text-[#929BAD]">No strong real-correlated terms detected.</p>
              ) : (
                <div className="space-y-2.5">
                  {ml.top_real_features.slice(0, 6).map((f) => (
                    <div key={`real-${f.term}`} className="space-y-1">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-[#F3F5F7] truncate max-w-[180px]">{f.term}</span>
                        <span className="text-[#C6FF4D]">{f.contribution.toFixed(4)}</span>
                      </div>
                      <div className="h-1.5 bg-[#080B12] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#C6FF4D] rounded-full"
                          style={{
                            width: `${Math.min(100, Math.max(8, Math.abs(f.contribution) * 200))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-display font-semibold text-[#F3F5F7] flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#9566FF]" />
              <span>Highlighted Token Contributions</span>
            </h3>
            <div className="flex items-center gap-4 text-xs text-[#929BAD]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#C6FF4D]/35 border border-[#C6FF4D]" />
                REAL-correlated
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#FF647C]/35 border border-[#FF647C]" />
                FAKE-correlated
              </span>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto pr-2 bg-[#080B12]/70 border border-white/8 rounded-xl p-4">
            <HighlightedText
              text={analysis.article_text}
              matchedTerms={ml.all_matched_terms}
            />
          </div>
        </div>
      </div>

      {/* 3. Source Credibility & Two-Column Fact Verification */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-display font-semibold text-[#F3F5F7] flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-[#28DFFF]" />
              <span>Source Intelligence</span>
            </h3>
            <span className="text-xs font-mono text-[#929BAD]">Independent of ML</span>
          </div>

          {source ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 bg-[#080B12]/70 border border-white/8 rounded-xl p-4 text-xs">
                <div>
                  <span className="text-[#929BAD] block">Domain</span>
                  <span className="text-[#F3F5F7] font-mono break-all">
                    {source.domain || 'Not provided'}
                  </span>
                </div>
                <div>
                  <span className="text-[#929BAD] block">Publisher</span>
                  <span className="text-[#F3F5F7]">{source.publisher_name || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-[#929BAD] block">Author Metadata</span>
                  <span className="text-[#F3F5F7]">{source.author_detected || 'Not detected'}</span>
                </div>
                <div>
                  <span className="text-[#929BAD] block">Publication Date</span>
                  <span className="text-[#F3F5F7] font-mono">
                    {source.publication_date || 'Not detected'}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-[#929BAD]">
                  Registry Classification:{' '}
                  <span className="text-[#28DFFF] font-mono uppercase">
                    {source.known_profile.status.replace(/_/g, ' ')}
                  </span>
                </p>
                <p className="text-xs text-[#F3F5F7]/85 leading-relaxed">
                  {source.known_profile.summary}
                </p>
              </div>

              {source.transparency_signals.length > 0 && (
                <ul className="space-y-1.5 text-xs text-[#F3F5F7]/85 pt-1">
                  {source.transparency_signals.map((sig, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#28DFFF] shrink-0" />
                      <span>{sig}</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-[11px] text-[#929BAD] pt-2 border-t border-white/10">
                {source.disclaimer}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#929BAD]">
              No source URL metadata available for this analysis.
            </p>
          )}
        </div>

        {/* Independent Verification Two-Column Comparison */}
        <div className="lg:col-span-7 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-display font-semibold text-[#F3F5F7] flex items-center gap-2">
              <Scale className="w-4 h-4 text-[#9566FF]" />
              <span>Independent Fact Verification</span>
            </h3>
            <span className="text-xs font-mono text-[#929BAD]">
              External Search Evidence (Separate From ML)
            </span>
          </div>

          {extractedClaims.length > 0 && (
            <div className="p-3.5 rounded-xl bg-[#080B12]/70 border border-white/8 space-y-1.5">
              <p className="text-[11px] font-mono text-[#28DFFF]">Extracted Core Claims</p>
              <ul className="space-y-1 text-xs text-[#F3F5F7]/90 list-disc pl-4">
                {extractedClaims.map((c, idx) => (
                  <li key={idx}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {refs.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2.5">
                <p className="text-xs font-mono text-[#C6FF4D]">
                  Supporting References ({supportingRefs.length})
                </p>
                {supportingRefs.length === 0 ? (
                  <p className="text-xs text-[#929BAD] p-3 rounded-xl bg-[#080B12]/60 border border-white/8">
                    No direct supporting references matched.
                  </p>
                ) : (
                  supportingRefs.map((ref, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl bg-[#080B12]/75 border border-[#C6FF4D]/20 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-[#F3F5F7] truncate">{ref.source_name}</span>
                        {ref.publication_date && (
                          <span className="font-mono text-[10px] text-[#929BAD]">
                            {ref.publication_date}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#929BAD] leading-relaxed">{ref.finding}</p>
                      <a
                        href={ref.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#C6FF4D] hover:underline"
                      >
                        <span>Inspect evidence</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-mono text-[#FF647C]">
                  Contradicting & Context ({challengingRefs.length})
                </p>
                {challengingRefs.length === 0 ? (
                  <p className="text-xs text-[#929BAD] p-3 rounded-xl bg-[#080B12]/60 border border-white/8">
                    No contradicting or secondary context references matched.
                  </p>
                ) : (
                  challengingRefs.map((ref, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl bg-[#080B12]/75 border border-[#FF647C]/20 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-[#F3F5F7] truncate">{ref.source_name}</span>
                        <span className="font-mono uppercase text-[10px] text-[#FF647C]">
                          {ref.stance}
                        </span>
                      </div>
                      <p className="text-xs text-[#929BAD] leading-relaxed">{ref.finding}</p>
                      <a
                        href={ref.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#28DFFF] hover:underline"
                      >
                        <span>Inspect evidence</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-[#080B12]/70 border border-white/8 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-[#F3F5F7]">
                <AlertCircle className="w-4 h-4 text-[#9566FF]" />
                <span>Independent verification unavailable</span>
              </div>
              <p className="text-xs text-[#929BAD] leading-relaxed">
                {factCheckReason ||
                  'No external fact-checking references were matched or enabled for this submission. Toggle independent fact-check references in the analyzer when GEMINI_API_KEY is configured.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 4. Limitations & User Feedback */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-3">
          <h3 className="text-sm font-display font-semibold text-[#F3F5F7]">
            Methodology Limitations
          </h3>
          <ul className="space-y-2 text-xs text-[#929BAD] leading-relaxed list-disc pl-4">
            {ml.limitations.map((lim, i) => (
              <li key={i}>{lim}</li>
            ))}
          </ul>
        </div>

        <form
          onSubmit={handleFeedbackSubmit}
          className="lg:col-span-7 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-display font-semibold text-[#F3F5F7] flex items-center gap-2">
              <MessageSquarePlus className="w-4 h-4 text-[#28DFFF]" />
              <span>Report Correction or Rate Analysis</span>
            </h3>
            <span className="text-[11px] font-mono text-[#929BAD]">
              Isolated from training datasets
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#929BAD] mb-1">Feedback Type</label>
              <select
                value={feedbackType}
                onChange={(e) => setFeedbackType(e.target.value)}
                className="w-full bg-[#080B12] border border-white/15 rounded-lg px-3 py-2 text-xs text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
              >
                <option value="incorrect_prediction">Report Incorrect Prediction</option>
                <option value="supporting_reference">Submit Supporting Reference</option>
                <option value="helpful_explanation">Helpful Explanation</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#929BAD] mb-1">Usefulness Rating (1–5)</label>
              <select
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
                className="w-full bg-[#080B12] border border-white/15 rounded-lg px-3 py-2 text-xs text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
              >
                <option value={5}>5 — Highly informative</option>
                <option value={4}>4 — Useful</option>
                <option value={3}>3 — Neutral</option>
                <option value={2}>2 — Needs context</option>
                <option value={1}>1 — Inaccurate</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Explain discrepancy or provide context..."
              className="w-full bg-[#080B12] border border-white/15 rounded-lg px-3 py-2 text-xs text-[#F3F5F7] placeholder:text-[#929BAD]/70 focus:outline-none focus:border-[#28DFFF]"
            />
            <input
              type="url"
              value={referenceUrl}
              onChange={(e) => setReferenceUrl(e.target.value)}
              placeholder="Optional evidence URL (https://...)"
              className="w-full bg-[#080B12] border border-white/15 rounded-lg px-3 py-2 text-xs text-[#F3F5F7] placeholder:text-[#929BAD]/70 focus:outline-none focus:border-[#28DFFF]"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {feedbackStatus ? (
              <p
                className={`text-xs ${feedbackStatus.ok ? 'text-[#C6FF4D]' : 'text-[#FF647C]'}`}
              >
                {feedbackStatus.msg}
              </p>
            ) : (
              <span className="text-xs text-[#929BAD]">
                Unverified feedback is reviewed by administrators before moderation.
              </span>
            )}
            <button
              type="submit"
              disabled={submittingFeedback}
              className="px-4 py-2 text-xs font-medium bg-[#161D2B] hover:bg-white/10 text-[#F3F5F7] border border-white/15 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {submittingFeedback ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  );
}

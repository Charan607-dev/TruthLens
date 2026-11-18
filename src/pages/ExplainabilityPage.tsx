import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BookOpen, ScanSearch, Sparkles } from 'lucide-react';
import { HighlightedText } from '../components/HighlightedText';
import { PredictionBadge } from '../components/PredictionBadge';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { apiRequest } from '../lib/api';
import { formatProbabilityPct, formatRawProbabilityPct } from '../lib/probability';
import { AnalysisResponse, HistoryItem } from '../types';

export function ExplainabilityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ items: HistoryItem[] }>('/api/history?sort=newest')
      .then((res) => {
        setHistory(res.items);
        const targetId = selectedId || res.items[0]?.id;
        if (!targetId) {
          setAnalysis(null);
          setLoading(false);
          return;
        }
        return apiRequest<AnalysisResponse>(`/api/history/${targetId}`).then((detail) => {
          setAnalysis(detail);
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load explainability data.'))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const ml = analysis?.ml_result;
  const chartData = ml
    ? [
        ...ml.top_real_features.slice(0, 6).map((f) => ({
          term: f.term,
          contribution: Number(f.contribution.toFixed(4)),
          direction: 'REAL',
        })),
        ...ml.top_fake_features.slice(0, 6).map((f) => ({
          term: f.term,
          contribution: Number(f.contribution.toFixed(4)),
          direction: 'FAKE',
        })),
      ].sort((a, b) => a.contribution - b.contribution)
    : [];

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-mono text-[#28DFFF]">Model Transparency</p>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7]">
              AI Explainability Inspector
            </h1>
            <p className="text-sm text-[#929BAD]">
              Inspect genuine TF-IDF weights, positive and negative feature contributions, and vocabulary coverage from actual model output.
            </p>
          </div>
          {history.length > 0 && (
            <div className="w-full sm:w-80">
              <label className="block text-[11px] font-mono text-[#929BAD] mb-1">
                Select Saved Analysis
              </label>
              <select
                value={analysis?.id || selectedId || ''}
                onChange={(e) => setSearchParams({ id: e.target.value })}
                className="w-full bg-[#101522] border border-white/15 rounded-xl px-3 py-2 text-xs text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
              >
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    [{h.prediction}] {h.headline.slice(0, 65)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-[#FF647C]/12 border border-[#FF647C]/30 text-xs text-[#FFB3BF]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="h-64 bg-[#101522]/70 border border-white/10 rounded-2xl animate-pulse" />
        ) : !analysis || !ml ? (
          <div className="bg-[#101522]/90 border border-white/10 rounded-2xl p-10 text-center space-y-4">
            <Sparkles className="w-8 h-8 text-[#28DFFF] mx-auto" />
            <h2 className="text-lg font-display font-semibold text-[#F3F5F7]">
              No Analyses Available to Inspect
            </h2>
            <p className="text-sm text-[#929BAD] max-w-md mx-auto">
              Run a headline, article, or URL check in the News Analyzer to examine token weights and feature attributions here.
            </p>
            <Link
              to="/analyze"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-[#C6FF4D] text-[#080B12] rounded-xl"
            >
              <ScanSearch className="w-4 h-4" />
              <span>Open News Analyzer</span>
            </Link>
          </div>
        ) : (
          <>
            {/* Summary Strip */}
            <div className="bg-[#101522]/90 border border-white/12 rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1 max-w-3xl">
                  <div className="flex items-center gap-3 text-xs font-mono text-[#929BAD]">
                    <span>{ml.model_name}</span>
                    <span>·</span>
                    <span>{ml.model_version}</span>
                  </div>
                  <h2 className="text-lg font-display font-semibold text-[#F3F5F7]">
                    {analysis.headline}
                  </h2>
                </div>
                <PredictionBadge prediction={ml.prediction} size="lg" />
              </div>

              <p className="text-sm text-[#F3F5F7]/90 leading-relaxed">{ml.explanation_summary}</p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-white/10 text-xs">
                <div className="p-3 rounded-xl bg-[#080B12]/70 border border-white/8">
                  <span className="text-[#929BAD] block">Vocabulary Coverage</span>
                  <span className="font-mono text-lg font-bold text-[#28DFFF]">
                    {ml.vocabulary_coverage !== undefined
                      ? `${(ml.vocabulary_coverage * 100).toFixed(1)}%`
                      : 'N/A'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#080B12]/70 border border-white/8">
                  <span className="text-[#929BAD] block">Matched Features</span>
                  <span className="font-mono text-lg font-bold text-[#F3F5F7]">
                    {ml.matched_features_count} / {ml.total_tokens}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#080B12]/70 border border-white/8">
                  <span className="text-[#929BAD] block">REAL Probability</span>
                  <span className="font-mono text-lg font-bold text-[#C6FF4D]">
                    {formatProbabilityPct(ml.prob_real, ml.uncertainty_threshold)}
                  </span>
                  <span className="block text-[10px] font-mono text-[#929BAD]">
                    Raw: {formatRawProbabilityPct(ml.prob_real)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#080B12]/70 border border-white/8">
                  <span className="text-[#929BAD] block">FAKE Probability</span>
                  <span className="font-mono text-lg font-bold text-[#FF647C]">
                    {formatProbabilityPct(ml.prob_fake, ml.uncertainty_threshold)}
                  </span>
                  <span className="block text-[10px] font-mono text-[#929BAD]">
                    Raw: {formatRawProbabilityPct(ml.prob_fake)}
                  </span>
                </div>
              </div>
            </div>

            {/* Feature Importance Chart + Highlighted Text */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-display font-semibold text-[#F3F5F7]">
                    Signed Feature Contribution Chart
                  </h3>
                  <span className="text-[11px] font-mono text-[#929BAD]">
                    − REAL / + FAKE
                  </span>
                </div>

                {chartData.length === 0 ? (
                  <p className="text-xs text-[#929BAD] py-8">
                    No significant non-zero feature contributions matched this text.
                  </p>
                ) : (
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} layout="vertical" margin={{ left: 24, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis type="number" stroke="#929BAD" fontSize={11} />
                        <YAxis
                          type="category"
                          dataKey="term"
                          stroke="#F3F5F7"
                          fontSize={11}
                          width={96}
                        />
                        <ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#161D2B',
                            border: '1px solid rgba(255,255,255,0.14)',
                            borderRadius: '10px',
                            fontSize: '12px',
                          }}
                        />
                        <Bar dataKey="contribution" radius={[4, 4, 4, 4]}>
                          {chartData.map((entry) => (
                            <Cell
                              key={entry.term}
                              fill={entry.contribution < 0 ? '#C6FF4D' : '#FF647C'}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="lg:col-span-6 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-display font-semibold text-[#F3F5F7] flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-[#9566FF]" />
                    <span>Highlighted Article Evidence</span>
                  </h3>
                  <span className="text-xs font-mono text-[#929BAD]">Hover tokens for weights</span>
                </div>
                <div className="max-h-80 overflow-y-auto bg-[#080B12]/75 border border-white/8 rounded-xl p-4">
                  <HighlightedText
                    text={analysis.article_text}
                    matchedTerms={ml.all_matched_terms}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </WorkspaceLayout>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ExternalLink, Scale, ScanSearch } from 'lucide-react';
import { PredictionBadge } from '../components/PredictionBadge';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { apiRequest } from '../lib/api';
import { AnalysisResponse, HistoryItem } from '../types';

export function FactVerificationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ items: HistoryItem[] }>('/api/history?sort=newest')
      .then((res) => {
        setHistory(res.items);
        const targetId = selectedId || res.items[0]?.id;
        if (!targetId) {
          setAnalysis(null);
          return;
        }
        return apiRequest<AnalysisResponse>(`/api/history/${targetId}`).then(setAnalysis);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedId]);

  const refs = analysis?.fact_check?.references || analysis?.verification_sources || [];
  const supporting = refs.filter((r) => r.stance === 'supporting');
  const contradictingOrContext = refs.filter((r) => r.stance !== 'supporting');
  const claims = analysis?.fact_check?.extracted_claims || [];

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-mono text-[#9566FF]">Independent Corroboration</p>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7]">
              Fact Verification Workspace
            </h1>
            <p className="text-sm text-[#929BAD]">
              Compare extracted factual claims against independent external references. Retrieved evidence is strictly separated from ML pattern classification.
            </p>
          </div>
          {history.length > 0 && (
            <div className="w-full sm:w-80">
              <label className="block text-[11px] font-mono text-[#929BAD] mb-1">
                Select Analysis Record
              </label>
              <select
                value={analysis?.id || selectedId || ''}
                onChange={(e) => setSearchParams({ id: e.target.value })}
                className="w-full bg-[#101522] border border-white/15 rounded-xl px-3 py-2 text-xs text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
              >
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.headline.slice(0, 65)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loading ? (
          <div className="h-64 bg-[#101522]/70 border border-white/10 rounded-2xl animate-pulse" />
        ) : !analysis ? (
          <div className="bg-[#101522]/90 border border-white/10 rounded-2xl p-10 text-center space-y-4">
            <Scale className="w-8 h-8 text-[#9566FF] mx-auto" />
            <h2 className="text-lg font-display font-semibold text-[#F3F5F7]">
              No Verification Records Yet
            </h2>
            <p className="text-sm text-[#929BAD] max-w-md mx-auto">
              Run an analysis with independent fact-check references enabled in the News Analyzer to investigate evidence here.
            </p>
            <Link
              to="/analyze"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-[#C6FF4D] text-[#080B12] rounded-xl"
            >
              <ScanSearch className="w-4 h-4" />
              <span>Run News Analysis</span>
            </Link>
          </div>
        ) : (
          <>
            {/* Claim Header + Epistemic Separation Banner */}
            <div className="bg-[#101522]/90 border border-white/12 rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-mono text-[#929BAD]">Subject Submission</p>
                  <h2 className="text-lg font-display font-semibold text-[#F3F5F7] mt-1">
                    {analysis.headline}
                  </h2>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-[#929BAD]">ML Score Context:</span>
                  <PredictionBadge prediction={analysis.ml_result.prediction} size="sm" />
                </div>
              </div>

              {claims.length > 0 && (
                <div className="p-4 rounded-xl bg-[#080B12]/75 border border-white/8 space-y-2">
                  <p className="text-xs font-mono text-[#28DFFF]">Extracted Claims</p>
                  <ul className="space-y-1.5 text-xs text-[#F3F5F7]/90 list-disc pl-4">
                    {claims.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Two-Column Evidence Comparison */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[#101522]/90 border border-[#C6FF4D]/20 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <h3 className="text-base font-display font-semibold text-[#C6FF4D]">
                    Supporting References
                  </h3>
                  <span className="text-xs font-mono text-[#929BAD]">{supporting.length}</span>
                </div>

                {supporting.length === 0 ? (
                  <p className="text-xs text-[#929BAD] py-6">
                    No supporting external references retrieved for this submission.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {supporting.map((ref, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-xl bg-[#080B12]/75 border border-white/10 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-[#F3F5F7]">{ref.source_name}</span>
                          {ref.publication_date && (
                            <span className="font-mono text-[#929BAD]">{ref.publication_date}</span>
                          )}
                        </div>
                        <p className="text-xs text-[#929BAD] leading-relaxed">{ref.finding}</p>
                        <a
                          href={ref.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-[#C6FF4D] hover:underline"
                        >
                          <span>Open source reference</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#101522]/90 border border-[#FF647C]/20 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <h3 className="text-base font-display font-semibold text-[#FF647C]">
                    Contradicting & Context References
                  </h3>
                  <span className="text-xs font-mono text-[#929BAD]">
                    {contradictingOrContext.length}
                  </span>
                </div>

                {contradictingOrContext.length === 0 ? (
                  <div className="py-6 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-[#F3F5F7]">
                      <AlertCircle className="w-4 h-4 text-[#9566FF]" />
                      <span>No contradicting or context citations stored</span>
                    </div>
                    <p className="text-xs text-[#929BAD]">
                      {analysis.fact_check?.reason ||
                        'Enable "Query independent fact-check references" when running a new analysis in the News Analyzer (requires GEMINI_API_KEY configured on the server).'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {contradictingOrContext.map((ref, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-xl bg-[#080B12]/75 border border-white/10 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-[#F3F5F7]">{ref.source_name}</span>
                          <span className="font-mono uppercase text-[11px] text-[#FF647C]">
                            {ref.stance}
                          </span>
                        </div>
                        <p className="text-xs text-[#929BAD] leading-relaxed">{ref.finding}</p>
                        <div className="flex items-center justify-between text-xs">
                          <a
                            href={ref.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-[#28DFFF] hover:underline"
                          >
                            <span>Open source reference</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          {ref.publication_date && (
                            <span className="font-mono text-[#929BAD]">{ref.publication_date}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </WorkspaceLayout>
  );
}

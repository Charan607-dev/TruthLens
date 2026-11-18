import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Globe2, Link2, Loader2, ShieldCheck } from 'lucide-react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { apiRequest } from '../lib/api';
import { AnalysisResponse, HistoryItem, SourceCredibilityReport } from '../types';

interface UrlInspectResponse {
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

export function SourceIntelligencePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [report, setReport] = useState<SourceCredibilityReport | null>(null);
  const [contextHeadline, setContextHeadline] = useState<string>('');
  const [urlInput, setUrlInput] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ items: HistoryItem[] }>('/api/history?sort=newest')
      .then((res) => {
        setHistory(res.items);
        const withUrl = res.items.find((i) => Boolean(i.source_url));
        const targetId = selectedId || withUrl?.id || res.items[0]?.id;
        if (targetId) {
          return apiRequest<AnalysisResponse>(`/api/history/${targetId}`).then((detail) => {
            setReport(detail.source_credibility);
            setContextHeadline(detail.headline);
          });
        }
      })
      .catch(() => {});
  }, [selectedId]);

  const handleInspectUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInspecting(true);
    try {
      const res = await apiRequest<UrlInspectResponse>('/api/analyze-url', {
        method: 'POST',
        body: JSON.stringify({ url: urlInput, preview_only: true }),
      });
      setReport(res.source_credibility);
      setContextHeadline(res.extracted.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to inspect publisher URL.');
    } finally {
      setInspecting(false);
    }
  };

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-mono text-[#28DFFF]">Publisher Diagnostics</p>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7]">
              Source Intelligence
            </h1>
            <p className="text-sm text-[#929BAD]">
              Inspect domain transparency, editorial metadata, and registry profiles independently from ML text classification. Unfamiliar publishers are never automatically labeled fake.
            </p>
          </div>
          {history.length > 0 && (
            <div className="w-full sm:w-80">
              <label className="block text-[11px] font-mono text-[#929BAD] mb-1">
                Load From Saved Analyses
              </label>
              <select
                value={selectedId || ''}
                onChange={(e) => setSearchParams({ id: e.target.value })}
                className="w-full bg-[#101522] border border-white/15 rounded-xl px-3 py-2 text-xs text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
              >
                <option value="">Choose a saved record...</option>
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.source_url ? `[URL] ${h.headline.slice(0, 52)}` : h.headline.slice(0, 60)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Live Publisher URL Inspection Bar */}
        <form
          onSubmit={handleInspectUrl}
          className="bg-[#101522]/90 border border-white/12 rounded-2xl p-5 flex flex-col sm:flex-row gap-3"
        >
          <div className="relative flex-1">
            <Link2 className="w-4 h-4 text-[#28DFFF] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="url"
              required
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Inspect any public article URL (https://www.bbc.com/news/...)"
              className="w-full bg-[#080B12] border border-white/15 rounded-xl pl-11 pr-4 py-2.5 text-sm text-[#F3F5F7] placeholder:text-[#929BAD]/60 focus:outline-none focus:border-[#28DFFF]"
            />
          </div>
          <button
            type="submit"
            disabled={inspecting}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            {inspecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Inspecting Domain...</span>
              </>
            ) : (
              <span>Inspect Source Profile</span>
            )}
          </button>
        </form>

        {error && (
          <div className="p-4 rounded-xl bg-[#FF647C]/12 border border-[#FF647C]/30 text-xs text-[#FFB3BF]">
            {error}
          </div>
        )}

        {report ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-[#101522]/90 border border-white/12 rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-[#161D2B] border border-white/10 text-[#28DFFF]">
                  <Globe2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-mono text-[#929BAD]">Domain Profile</p>
                  <h2 className="text-lg font-display font-bold text-[#F3F5F7] truncate">
                    {report.domain || 'No Domain Provided'}
                  </h2>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-[#080B12]/75 border border-white/8">
                  <span className="text-[#929BAD] block">Publisher</span>
                  <span className="text-[#F3F5F7] font-medium mt-0.5 block">
                    {report.publisher_name || 'Unidentified'}
                  </span>
                </div>
                <div className="p-3.5 rounded-xl bg-[#080B12]/75 border border-white/8">
                  <span className="text-[#929BAD] block">Transport Security</span>
                  <span
                    className={`font-mono mt-0.5 block ${
                      report.uses_https ? 'text-[#C6FF4D]' : 'text-[#929BAD]'
                    }`}
                  >
                    {report.uses_https === null ? 'N/A' : report.uses_https ? 'HTTPS Verified' : 'Non-HTTPS'}
                  </span>
                </div>
                <div className="p-3.5 rounded-xl bg-[#080B12]/75 border border-white/8">
                  <span className="text-[#929BAD] block">Author Metadata</span>
                  <span className="text-[#F3F5F7] mt-0.5 block">
                    {report.author_detected || 'Not detected'}
                  </span>
                </div>
                <div className="p-3.5 rounded-xl bg-[#080B12]/75 border border-white/8">
                  <span className="text-[#929BAD] block">Publication Date</span>
                  <span className="text-[#F3F5F7] font-mono mt-0.5 block">
                    {report.publication_date || 'Not detected'}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#080B12]/70 border border-white/8 text-xs text-[#929BAD] leading-relaxed">
                {report.disclaimer}
              </div>
            </div>

            <div className="lg:col-span-7 bg-[#101522]/90 border border-white/12 rounded-2xl p-6 space-y-5">
              <div>
                <p className="text-xs font-mono text-[#28DFFF] uppercase">
                  {report.known_profile.status.replace(/_/g, ' ')}
                </p>
                <h3 className="text-lg font-display font-semibold text-[#F3F5F7] mt-1">
                  {contextHeadline || 'Transparency & Editorial Standards'}
                </h3>
              </div>

              <p className="text-sm text-[#F3F5F7]/90 leading-relaxed">
                {report.known_profile.summary}
              </p>

              <div className="p-4 rounded-xl bg-[#080B12]/70 border border-white/8 space-y-1.5">
                <p className="text-xs font-mono text-[#929BAD]">Editorial Standards Note</p>
                <p className="text-xs text-[#F3F5F7]/85 leading-relaxed">
                  {report.known_profile.editorial_standards}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-[#929BAD]">Detected Transparency Signals</p>
                {report.transparency_signals.length === 0 ? (
                  <p className="text-xs text-[#929BAD]">
                    No automated transparency signals detected for this submission.
                  </p>
                ) : (
                  <ul className="space-y-2 text-xs text-[#F3F5F7]">
                    {report.transparency_signals.map((sig, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-[#C6FF4D] shrink-0" />
                        <span>{sig}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-[#101522]/90 border border-white/10 rounded-2xl p-10 text-center text-sm text-[#929BAD]">
            Enter a public news URL above or select a saved analysis to inspect source transparency.
          </div>
        )}
      </div>
    </WorkspaceLayout>
  );
}

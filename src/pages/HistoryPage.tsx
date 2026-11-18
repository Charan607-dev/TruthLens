import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Eye, Search, Trash2 } from 'lucide-react';
import { PredictionBadge } from '../components/PredictionBadge';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { apiRequest } from '../lib/api';
import { generateAnalysisPdfReport } from '../lib/pdfExport';
import { AnalysisResponse, HistoryItem } from '../types';

export function HistoryPage() {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [filter, setFilter] = useState<'ALL' | 'REAL' | 'FAKE' | 'UNCERTAIN'>('ALL');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qParam = searchParams.get('q');
    if (qParam !== null) {
      setSearch(qParam);
    }
  }, [searchParams]);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        search,
        prediction: filter,
        sort,
      });
      const res = await apiRequest<{ items: HistoryItem[] }>(`/api/history?${qs.toString()}`);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load analysis history.');
    } finally {
      setLoading(false);
    }
  }, [search, filter, sort]);

  useEffect(() => {
    const t = setTimeout(fetchHistory, 180);
    return () => clearTimeout(t);
  }, [fetchHistory]);

  const handleDelete = async (id: string) => {
    try {
      await apiRequest(`/api/history/${id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const handleExportPdf = async (id: string) => {
    setExportingId(id);
    try {
      const full = await apiRequest<AnalysisResponse>(`/api/history/${id}`);
      generateAnalysisPdfReport(full);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setExportingId(null);
    }
  };

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-mono text-[#28DFFF]">Verification Archive</p>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7]">
              Analysis History
            </h1>
            <p className="text-sm text-[#929BAD]">
              Search, filter, inspect full explainability reports, export PDF dossiers, or remove saved records.
            </p>
          </div>
          <Link
            to="/analyze"
            className="px-4 py-2.5 text-xs font-semibold bg-[#C6FF4D] hover:bg-[#D5FF75] text-[#080B12] rounded-xl whitespace-nowrap shrink-0"
          >
            New Analysis
          </Link>
        </div>

        {/* Editorial Filters Toolbar */}
        <div className="bg-[#101522]/90 border border-white/12 rounded-2xl p-4 flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#929BAD] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search headlines, article text, or domain..."
              className="w-full bg-[#080B12] border border-white/15 rounded-xl pl-9 pr-3 py-2 text-xs text-[#F3F5F7] placeholder:text-[#929BAD]/60 focus:outline-none focus:border-[#28DFFF]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex p-1 bg-[#080B12] border border-white/10 rounded-xl gap-1">
              {(['ALL', 'REAL', 'FAKE', 'UNCERTAIN'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                    filter === f
                      ? 'bg-[#C6FF4D] text-[#080B12] font-semibold'
                      : 'text-[#929BAD] hover:text-[#F3F5F7]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')}
              className="bg-[#080B12] border border-white/15 rounded-xl px-3 py-2 text-xs text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-[#FF647C]/12 border border-[#FF647C]/30 text-xs text-[#FFB3BF]">
            {error}
          </div>
        )}

        {/* Editorial Dossier Stream */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-24 bg-[#101522]/70 border border-white/10 rounded-2xl animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-[#101522]/90 border border-white/10 rounded-2xl p-12 text-center space-y-3">
            <p className="text-sm text-[#929BAD]">No matching analysis records found.</p>
            <Link
              to="/analyze"
              className="inline-block px-4 py-2 text-xs font-semibold bg-[#C6FF4D] text-[#080B12] rounded-xl"
            >
              Analyse News Article
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-[#101522]/90 border border-white/10 hover:border-white/20 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#929BAD]">
                    <span className="uppercase text-[#28DFFF]">{item.input_mode}</span>
                    <span>·</span>
                    <span>
                      {item.model_name} ({item.model_version})
                    </span>
                    <span>·</span>
                    <span>{new Date(item.created_at).toLocaleString()}</span>
                  </div>
                  <Link
                    to={`/history/${item.id}`}
                    className="block text-base font-display font-semibold text-[#F3F5F7] hover:text-[#28DFFF] truncate"
                  >
                    {item.headline}
                  </Link>
                  {item.source_url && (
                    <p className="text-xs font-mono text-[#929BAD] truncate">{item.source_url}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <PredictionBadge prediction={item.prediction} size="sm" />
                  <span className="text-sm font-mono font-semibold tabular-nums text-[#F3F5F7] w-14 text-right">
                    {(item.confidence * 100).toFixed(1)}%
                  </span>

                  <div className="flex items-center gap-1.5 pl-2 border-l border-white/10">
                    <Link
                      to={`/history/${item.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#161D2B] hover:bg-white/10 text-[#F3F5F7] rounded-lg border border-white/10"
                      title="Open full report"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#28DFFF]" />
                      <span>Inspect</span>
                    </Link>
                    <button
                      type="button"
                      disabled={exportingId === item.id}
                      onClick={() => handleExportPdf(item.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#161D2B] hover:bg-white/10 text-[#F3F5F7] rounded-lg border border-white/10 cursor-pointer disabled:opacity-50"
                      title="Download PDF Report"
                    >
                      <Download className="w-3.5 h-3.5 text-[#C6FF4D]" />
                      <span>{exportingId === item.id ? '...' : 'PDF'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="p-2 text-[#929BAD] hover:text-[#FF647C] rounded-lg hover:bg-[#FF647C]/10 cursor-pointer"
                      title="Delete record"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WorkspaceLayout>
  );
}

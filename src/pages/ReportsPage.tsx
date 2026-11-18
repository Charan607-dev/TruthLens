import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Eye, FileBarChart2, ScanSearch } from 'lucide-react';
import { PredictionBadge } from '../components/PredictionBadge';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { apiRequest } from '../lib/api';
import { generateAnalysisPdfReport } from '../lib/pdfExport';
import { AnalysisResponse, HistoryItem } from '../types';

export function ReportsPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'REAL' | 'FAKE' | 'UNCERTAIN'>('ALL');
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiRequest<{ items: HistoryItem[] }>(`/api/history?prediction=${filter}&sort=newest`)
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load reports.'))
      .finally(() => setLoading(false));
  }, [filter]);

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    setError(null);
    try {
      const full = await apiRequest<AnalysisResponse>(`/api/history/${id}`);
      generateAnalysisPdfReport(full);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate PDF report.');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-mono text-[#C6FF4D]">Exportable Dossiers</p>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#F3F5F7]">
              Intelligence Reports
            </h1>
            <p className="text-sm text-[#929BAD]">
              Generate structured PDF verification reports containing calibrated scores, TF-IDF attribution, source transparency, and methodology disclaimers.
            </p>
          </div>
          <div className="inline-flex p-1 bg-[#101522] border border-white/10 rounded-xl gap-1 w-fit">
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
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-[#FF647C]/12 border border-[#FF647C]/30 text-xs text-[#FFB3BF]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-48 bg-[#101522]/70 border border-white/10 rounded-2xl animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-[#101522]/90 border border-white/10 rounded-2xl p-10 text-center space-y-4">
            <FileBarChart2 className="w-8 h-8 text-[#28DFFF] mx-auto" />
            <h2 className="text-lg font-display font-semibold text-[#F3F5F7]">
              No Reports Ready for Export
            </h2>
            <p className="text-sm text-[#929BAD] max-w-md mx-auto">
              Every news check is automatically formatted into an exportable PDF dossier. Run an analysis to generate your first report.
            </p>
            <Link
              to="/analyze"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-[#C6FF4D] text-[#080B12] rounded-xl"
            >
              <ScanSearch className="w-4 h-4" />
              <span>Analyse News</span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-[#101522]/90 border border-white/12 hover:border-[#28DFFF]/35 rounded-2xl p-5 flex flex-col justify-between space-y-5 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <PredictionBadge prediction={item.prediction} size="sm" />
                    <span className="text-sm font-mono font-bold tabular-nums text-[#F3F5F7]">
                      {(item.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <h2 className="text-base font-display font-semibold text-[#F3F5F7] line-clamp-2 leading-snug">
                    {item.headline}
                  </h2>
                  <p className="text-[11px] font-mono text-[#929BAD]">
                    {item.model_name} · {item.model_version} ·{' '}
                    {new Date(item.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center gap-2.5 pt-3 border-t border-white/10">
                  <button
                    type="button"
                    disabled={downloadingId === item.id}
                    onClick={() => handleDownload(item.id)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{downloadingId === item.id ? 'Building PDF...' : 'Download PDF'}</span>
                  </button>
                  <Link
                    to={`/history/${item.id}`}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#161D2B] hover:bg-white/10 text-[#F3F5F7] border border-white/12 rounded-xl"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#28DFFF]" />
                    <span>View</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WorkspaceLayout>
  );
}

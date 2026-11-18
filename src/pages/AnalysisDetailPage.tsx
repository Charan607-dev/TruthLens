import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, ShieldAlert, Sparkles } from 'lucide-react';
import { AnalysisResultView } from '../components/AnalysisResultView';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { apiRequest } from '../lib/api';
import { generateAnalysisPdfReport } from '../lib/pdfExport';
import { AnalysisResponse } from '../types';

export function AnalysisDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    apiRequest<AnalysisResponse>(`/api/history/${id}`)
      .then(setAnalysis)
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load report.'))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            to="/history"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#F3F5F7] bg-[#101522] hover:bg-[#161D2B] border border-white/10 rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#28DFFF]" />
            <span>Back to Archive</span>
          </Link>

          {analysis && (
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                to={`/explainability?id=${analysis.id}`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#F3F5F7] bg-[#101522] hover:bg-[#161D2B] border border-white/10 rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#9566FF]" />
                <span>Deep Explainability</span>
              </Link>
              <button
                type="button"
                onClick={() => generateAnalysisPdfReport(analysis)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#d5ff7a] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download PDF Dossier</span>
              </button>
            </div>
          )}
        </div>

        {loading && (
          <div className="bg-[#101522]/85 border border-white/10 rounded-2xl p-10 text-center space-y-2">
            <div className="w-7 h-7 border-2 border-[#28DFFF] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-mono text-[#929BAD]">
              Reconstructing verification dossier...
            </p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-[#FF647C]/10 border border-[#FF647C]/30 text-sm text-[#FF647C] flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {analysis && <AnalysisResultView analysis={analysis} />}
      </div>
    </WorkspaceLayout>
  );
}

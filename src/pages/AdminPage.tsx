import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Database,
  Grid2x2,
  MessageSquare,
  Play,
  Power,
  ShieldAlert,
  Upload,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PredictionBadge } from '../components/PredictionBadge';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { apiRequest } from '../lib/api';
import { DatasetRecord, ModelVersionRecord } from '../types';

type AdminTab = 'training' | 'datasets' | 'users' | 'feedback' | 'monitoring';

interface CsvPreviewResponse {
  headers: string[];
  detected_mapping: {
    titleCol: string | null;
    textCol: string;
    labelCol: string;
  };
  total_rows: number;
  valid_rows: number;
  fake_count: number;
  real_count: number;
  duplicates_removed: number;
  missing_removed: number;
  sample_rows: Array<{ title: string; text: string; label: 'FAKE' | 'REAL' }>;
  warnings: string[];
}

interface AdminUserRow {
  id: string;
  full_name: string;
  email: string;
  role: 'user' | 'admin';
  created_at: string;
  analysis_count: number;
}

interface AdminFeedbackRow {
  id: string;
  user_email: string;
  headline: string;
  prediction: 'REAL' | 'FAKE' | 'UNCERTAIN';
  confidence: number;
  feedback_type: string;
  rating: number | null;
  comments: string;
  reference_url: string | null;
  moderation_status: 'pending' | 'reviewed' | 'dismissed';
  created_at: string;
}

interface AdminAnalysisRow {
  id: string;
  input_mode: string;
  headline: string;
  prediction: 'REAL' | 'FAKE' | 'UNCERTAIN';
  confidence: number;
  model_name: string;
  model_version: string;
  user_email: string;
  created_at: string;
}

interface SystemHealth {
  total_users: number;
  total_analyses: number;
  total_datasets: number;
  total_models: number;
  pending_feedback: number;
  uptime_seconds: number;
  node_version: string;
  gemini_grounding_configured: boolean;
  supabase_configured: boolean;
}

function ConfusionMatrixCard({ model }: { model: ModelVersionRecord }) {
  const cm = model.confusion_matrix;
  if (!cm) return null;
  const [[tn, fp], [fn, tp]] = cm;
  const total = Math.max(1, tn + fp + fn + tp);

  return (
    <div className="bg-[#161D2B]/80 border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#F3F5F7] truncate">{model.model_name}</p>
          <p className="text-[11px] font-mono text-[#929BAD]">
            {model.version} · Acc {(model.accuracy * 100).toFixed(1)}% · F1{' '}
            {(model.f1_score * 100).toFixed(1)}%
          </p>
        </div>
        <span
          className={`text-[11px] font-mono uppercase shrink-0 ${
            model.status === 'active' ? 'text-[#C6FF4D]' : 'text-[#929BAD]'
          }`}
        >
          {model.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <div className="rounded-lg bg-[#C6FF4D]/12 border border-[#C6FF4D]/25 p-2.5">
          <span className="text-[10px] text-[#929BAD] block">TN (True REAL)</span>
          <span className="text-base font-bold text-[#C6FF4D] tabular-nums">{tn}</span>
          <span className="text-[10px] text-[#929BAD] ml-1.5">
            ({((tn / total) * 100).toFixed(0)}%)
          </span>
        </div>
        <div className="rounded-lg bg-[#FF647C]/10 border border-[#FF647C]/20 p-2.5">
          <span className="text-[10px] text-[#929BAD] block">FP (REAL as FAKE)</span>
          <span className="text-base font-bold text-[#FF647C] tabular-nums">{fp}</span>
          <span className="text-[10px] text-[#929BAD] ml-1.5">
            ({((fp / total) * 100).toFixed(0)}%)
          </span>
        </div>
        <div className="rounded-lg bg-[#9566FF]/10 border border-[#9566FF]/20 p-2.5">
          <span className="text-[10px] text-[#929BAD] block">FN (FAKE as REAL)</span>
          <span className="text-base font-bold text-[#9566FF] tabular-nums">{fn}</span>
          <span className="text-[10px] text-[#929BAD] ml-1.5">
            ({((fn / total) * 100).toFixed(0)}%)
          </span>
        </div>
        <div className="rounded-lg bg-[#28DFFF]/12 border border-[#28DFFF]/25 p-2.5">
          <span className="text-[10px] text-[#929BAD] block">TP (True FAKE)</span>
          <span className="text-base font-bold text-[#28DFFF] tabular-nums">{tp}</span>
          <span className="text-[10px] text-[#929BAD] ml-1.5">
            ({((tp / total) * 100).toFixed(0)}%)
          </span>
        </div>
      </div>

      {model.cv_scores?.per_class && (
        <div className="flex items-center justify-between text-[11px] font-mono text-[#929BAD] pt-1 border-t border-white/5">
          <span>
            REAL F1:{' '}
            <strong className="text-[#C6FF4D]">
              {(model.cv_scores.per_class.real.f1 * 100).toFixed(1)}%
            </strong>
          </span>
          <span>
            FAKE F1:{' '}
            <strong className="text-[#28DFFF]">
              {(model.cv_scores.per_class.fake.f1 * 100).toFixed(1)}%
            </strong>
          </span>
          {model.cv_scores.brier_score !== undefined && (
            <span>Brier: {model.cv_scores.brier_score.toFixed(3)}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('training');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [models, setModels] = useState<ModelVersionRecord[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [feedback, setFeedback] = useState<AdminFeedbackRow[]>([]);
  const [analyses, setAnalyses] = useState<AdminAnalysisRow[]>([]);
  const [system, setSystem] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Training Config State
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [selectedAlgos, setSelectedAlgos] = useState<string[]>([
    'tfidf_logreg',
    'tfidf_nb',
    'tfidf_svm',
  ]);
  const [testRatio, setTestRatio] = useState(0.2);
  const [cvFolds, setCvFolds] = useState(3);
  const [maxFeatures, setMaxFeatures] = useState(6500);
  const [removeStopwords, setRemoveStopwords] = useState(true);
  const [useBigrams, setUseBigrams] = useState(true);
  const [trainingJob, setTrainingJob] = useState<{
    id?: string;
    status: string;
    progress: number;
    current_step?: string;
    error?: string;
  } | null>(null);

  // Dataset Upload State
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState('');
  const [datasetFormat, setDatasetFormat] = useState('welfake');
  const [titleCol, setTitleCol] = useState('');
  const [textCol, setTextCol] = useState('');
  const [labelCol, setLabelCol] = useState('');
  const [numericFakeValue, setNumericFakeValue] = useState<'1' | '0'>('1');
  const [csvPreview, setCsvPreview] = useState<CsvPreviewResponse | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [dsRes, modRes, usrRes, fbRes, anRes, sysRes] = await Promise.all([
        apiRequest<{ datasets: DatasetRecord[] }>('/api/admin/datasets'),
        apiRequest<{ models: ModelVersionRecord[] }>('/api/admin/models'),
        apiRequest<{ users: AdminUserRow[] }>('/api/admin/users'),
        apiRequest<{ feedback: AdminFeedbackRow[] }>('/api/admin/feedback'),
        apiRequest<{ analyses: AdminAnalysisRow[] }>('/api/admin/analyses'),
        apiRequest<SystemHealth>('/api/admin/system'),
      ]);
      setDatasets(dsRes.datasets);
      setModels(modRes.models);
      setUsers(usrRes.users);
      setFeedback(fbRes.feedback);
      setAnalyses(anRes.analyses);
      setSystem(sysRes);
      if (dsRes.datasets.length > 0) {
        setSelectedDatasetId((prev) => prev || dsRes.datasets[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin console.');
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Poll training job status while running
  useEffect(() => {
    if (!trainingJob || trainingJob.status !== 'running') return;
    const interval = setInterval(async () => {
      try {
        const res = await apiRequest<{
          id: string;
          status: string;
          progress: number;
          current_step?: string;
          error?: string;
        }>(`/api/admin/train/status?job_id=${trainingJob.id}`);
        setTrainingJob(res);
        if (res.status === 'completed' || res.status === 'failed') {
          clearInterval(interval);
          loadAll();
        }
      } catch {
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [trainingJob, loadAll]);

  const toggleAlgo = (algo: string) => {
    setSelectedAlgos((prev) =>
      prev.includes(algo) ? prev.filter((a) => a !== algo) : [...prev, algo]
    );
  };

  const handleStartTraining = async () => {
    setError(null);
    setNotice(null);
    if (!selectedDatasetId || selectedAlgos.length === 0) {
      setError('Select a dataset and at least one algorithm.');
      return;
    }
    try {
      const res = await apiRequest<{ job_id: string; status: string }>('/api/admin/train', {
        method: 'POST',
        body: JSON.stringify({
          dataset_id: selectedDatasetId,
          algorithms: selectedAlgos,
          test_ratio: testRatio,
          cv_folds: cvFolds,
          max_features: maxFeatures,
          remove_stopwords: removeStopwords,
          use_bigrams: useBigrams,
        }),
      });
      setTrainingJob({
        id: res.job_id,
        status: 'running',
        progress: 10,
        current_step: 'Starting training pipeline...',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start training.');
    }
  };

  const handleActivateModel = async (modelId: string | null, deactivate = false) => {
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/admin/models/activate', {
        method: 'POST',
        body: JSON.stringify(deactivate ? { deactivate: true } : { model_id: modelId }),
      });
      setNotice(res.message);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update model status.');
    }
  };

  const handleInspectCsv = async (overrideMap = false) => {
    if (!csvFile) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', csvFile);
      form.append('numeric_fake_value', numericFakeValue);
      if (overrideMap) {
        if (titleCol) form.append('title_col', titleCol);
        if (textCol) form.append('text_col', textCol);
        if (labelCol) form.append('label_col', labelCol);
      }
      const res = await apiRequest<CsvPreviewResponse>('/api/admin/datasets/preview', {
        method: 'POST',
        body: form,
      });
      setCsvPreview(res);
      if (!overrideMap) {
        setTitleCol(res.detected_mapping.titleCol || '');
        setTextCol(res.detected_mapping.textCol || '');
        setLabelCol(res.detected_mapping.labelCol || '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV inspection failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleUploadDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile) return;
    setError(null);
    setNotice(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', csvFile);
      form.append('name', datasetName || csvFile.name.replace(/\.csv$/i, ''));
      form.append('dataset_format', datasetFormat);
      form.append('numeric_fake_value', numericFakeValue);
      if (titleCol) form.append('title_col', titleCol);
      if (textCol) form.append('text_col', textCol);
      if (labelCol) form.append('label_col', labelCol);

      await apiRequest('/api/admin/datasets/upload', {
        method: 'POST',
        body: form,
      });
      setNotice('Dataset validated and saved successfully.');
      setCsvFile(null);
      setCsvPreview(null);
      setDatasetName('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dataset upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleRoleToggle = async (userId: string, nextRole: 'user' | 'admin') => {
    setError(null);
    try {
      await apiRequest(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update role.');
    }
  };

  const handleFeedbackModeration = async (id: string, status: 'reviewed' | 'dismissed') => {
    try {
      await apiRequest(`/api/admin/feedback/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ moderation_status: status }),
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update feedback.');
    }
  };

  const comparisonChartData = models.slice(0, 6).map((m) => ({
    name: `${m.model_name.replace('TF-IDF + ', '')} (${m.version})`,
    Accuracy: Number((m.accuracy * 100).toFixed(1)),
    F1: Number((m.f1_score * 100).toFixed(1)),
    Precision: Number((m.precision_score * 100).toFixed(1)),
    Recall: Number((m.recall_score * 100).toFixed(1)),
  }));

  const modelsWithMatrix = models.filter((m) => m.confusion_matrix).slice(0, 3);

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#28DFFF]">
              ML Operations Control Plane
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F3F5F7] mt-1">
              Administrator & ML Console
            </h1>
            <p className="text-sm text-[#929BAD] mt-1">
              Train stratified NLP classifiers, audit confusion matrices, validate labeled corpora,
              and govern platform operations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleActivateModel(null, true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#FF647C] bg-[#FF647C]/10 hover:bg-[#FF647C]/20 border border-[#FF647C]/25 rounded-xl whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <Power className="w-3.5 h-3.5" />
            <span>Deactivate Active Model</span>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-1.5 p-1.5 bg-[#101522] border border-white/10 rounded-xl w-fit">
          {[
            { id: 'training' as const, label: 'ML Training & Models', icon: Cpu },
            { id: 'datasets' as const, label: 'Datasets', icon: Database },
            { id: 'users' as const, label: 'Users', icon: Users },
            { id: 'feedback' as const, label: 'Feedback', icon: MessageSquare },
            { id: 'monitoring' as const, label: 'Monitoring & Health', icon: Activity },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active ? 'text-[#080B12] font-semibold' : 'text-[#929BAD] hover:text-[#F3F5F7]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="adminTabPill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 bg-[#C6FF4D] rounded-lg"
                  />
                )}
                <Icon className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-[#FF647C]/10 border border-[#FF647C]/30 text-xs text-[#FF647C] flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="p-3.5 rounded-xl bg-[#C6FF4D]/10 border border-[#C6FF4D]/30 text-xs text-[#C6FF4D] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* TAB 1: MODEL TRAINING & COMPARISON */}
        {tab === 'training' && (
          <div className="space-y-6">
            <div className="bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-[#F3F5F7]">
                  Train & Evaluate New Model Versions
                </h2>
                <span className="text-xs font-mono text-[#929BAD]">
                  Models remain inactive until manually verified & activated
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-mono text-[#929BAD] mb-1.5">
                    Training Dataset
                  </label>
                  <select
                    value={selectedDatasetId}
                    onChange={(e) => setSelectedDatasetId(e.target.value)}
                    className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3 py-2.5 text-xs text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
                  >
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.record_count} rows · {d.fake_count}F / {d.real_count}R)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-[#929BAD] mb-1.5">
                    Held-Out Test Split Ratio ({Math.round(testRatio * 100)}%)
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={0.35}
                    step={0.05}
                    value={testRatio}
                    onChange={(e) => setTestRatio(Number(e.target.value))}
                    className="w-full accent-[#C6FF4D] mt-2.5 cursor-pointer"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono text-[#929BAD] mb-1.5">
                      CV Folds
                    </label>
                    <select
                      value={cvFolds}
                      onChange={(e) => setCvFolds(Number(e.target.value))}
                      className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3 py-2.5 text-xs text-[#F3F5F7]"
                    >
                      <option value={2}>2-Fold CV</option>
                      <option value={3}>3-Fold CV</option>
                      <option value={5}>5-Fold CV</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-[#929BAD] mb-1.5">
                      Max TF-IDF Vocab
                    </label>
                    <input
                      type="number"
                      min={500}
                      max={10000}
                      step={500}
                      value={maxFeatures}
                      onChange={(e) => setMaxFeatures(Number(e.target.value))}
                      className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3 py-2.5 text-xs text-[#F3F5F7] font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-white/10">
                <div className="flex flex-wrap items-center gap-4 text-xs text-[#F3F5F7]">
                  {[
                    { id: 'tfidf_logreg', label: 'Logistic Regression' },
                    { id: 'tfidf_nb', label: 'Multinomial Naive Bayes' },
                    { id: 'tfidf_svm', label: 'Linear SVM' },
                  ].map((algo) => (
                    <label key={algo.id} className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedAlgos.includes(algo.id)}
                        onChange={() => toggleAlgo(algo.id)}
                        className="accent-[#28DFFF]"
                      />
                      <span>{algo.label}</span>
                    </label>
                  ))}
                  <label className="inline-flex items-center gap-2 cursor-pointer pl-3 border-l border-white/10">
                    <input
                      type="checkbox"
                      checked={removeStopwords}
                      onChange={(e) => setRemoveStopwords(e.target.checked)}
                      className="accent-[#9566FF]"
                    />
                    <span>Stopword Removal</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useBigrams}
                      onChange={(e) => setUseBigrams(e.target.checked)}
                      className="accent-[#9566FF]"
                    />
                    <span>Bigrams (1,2)</span>
                  </label>
                </div>

                <button
                  type="button"
                  disabled={trainingJob?.status === 'running'}
                  onClick={handleStartTraining}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#d5ff7a] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>
                    {trainingJob?.status === 'running' ? 'Training...' : 'Start Model Training'}
                  </span>
                </button>
              </div>

              {trainingJob && trainingJob.status !== 'idle' && (
                <div className="p-4 rounded-xl bg-[#080B12]/90 border border-white/10 space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span
                      className={
                        trainingJob.status === 'failed'
                          ? 'text-[#FF647C]'
                          : trainingJob.status === 'completed'
                            ? 'text-[#C6FF4D]'
                            : 'text-[#28DFFF]'
                      }
                    >
                      {trainingJob.error || trainingJob.current_step}
                    </span>
                    <span className="text-[#F3F5F7] tabular-nums">{trainingJob.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-[#161D2B] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#28DFFF] transition-all duration-300"
                      style={{ width: `${trainingJob.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Visual Confusion Matrices + Model Comparison Chart */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              {comparisonChartData.length > 0 && (
                <div className="xl:col-span-7 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-semibold text-[#F3F5F7]">
                      Model Evaluation Benchmarks (%)
                    </h2>
                    <span className="text-[11px] font-mono text-[#929BAD]">Held-Out Split</span>
                  </div>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={comparisonChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="name" stroke="#929BAD" fontSize={11} />
                        <YAxis domain={[0, 100]} stroke="#929BAD" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#080B12',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '10px',
                            fontSize: '12px',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <Bar dataKey="Accuracy" fill="#C6FF4D" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="F1" fill="#28DFFF" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Precision" fill="#9566FF" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Recall" fill="#FF647C" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {modelsWithMatrix.length > 0 && (
                <div className="xl:col-span-5 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Grid2x2 className="w-4 h-4 text-[#28DFFF]" />
                    <h2 className="font-display text-base font-semibold text-[#F3F5F7]">
                      Confusion Matrix Diagnostics
                    </h2>
                  </div>
                  <div className="space-y-3">
                    {modelsWithMatrix.map((m) => (
                      <ConfusionMatrixCard key={m.id} model={m} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Model Version Registry Table */}
            <div className="bg-[#101522]/90 border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/10">
                <h2 className="font-display text-base font-semibold text-[#F3F5F7]">
                  Model Version Registry
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[#929BAD] font-mono">
                      <th className="py-3 px-5">Model / Version</th>
                      <th className="py-3 px-3">Dataset</th>
                      <th className="py-3 px-3 text-right">Acc</th>
                      <th className="py-3 px-3 text-right">F1</th>
                      <th className="py-3 px-3 text-right">ROC-AUC</th>
                      <th className="py-3 px-3 text-right">Brier</th>
                      <th className="py-3 px-3 text-right">CV F1</th>
                      <th className="py-3 px-3 text-center">Class F1 (R / F)</th>
                      <th className="py-3 px-3 text-center">Confusion [TN,FP / FN,TP]</th>
                      <th className="py-3 px-5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {models.map((m) => (
                      <tr key={m.id} className="hover:bg-white/[0.02]">
                        <td className="py-3.5 px-5">
                          <span className="font-semibold text-[#F3F5F7] block">{m.model_name}</span>
                          <span className="font-mono text-[#929BAD]">
                            {m.version} · {new Date(m.trained_at).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-[#929BAD]">
                          {m.dataset_name} ({m.dataset_size})
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#F3F5F7]">
                          {(m.accuracy * 100).toFixed(1)}%
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#28DFFF]">
                          {(m.f1_score * 100).toFixed(1)}%
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#F3F5F7]">
                          {m.roc_auc.toFixed(3)}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#929BAD]">
                          {m.cv_scores?.brier_score !== undefined
                            ? m.cv_scores.brier_score.toFixed(3)
                            : '—'}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#929BAD]">
                          {m.cv_scores ? `${(m.cv_scores.cv_f1_mean * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-3.5 px-3 text-center font-mono tabular-nums text-[#929BAD]">
                          {m.cv_scores?.per_class
                            ? `${(m.cv_scores.per_class.real.f1 * 100).toFixed(0)}% / ${(m.cv_scores.per_class.fake.f1 * 100).toFixed(0)}%`
                            : '—'}
                        </td>
                        <td className="py-3.5 px-3 text-center font-mono text-[#929BAD]">
                          {m.confusion_matrix
                            ? `[${m.confusion_matrix[0][0]}, ${m.confusion_matrix[0][1]}] / [${m.confusion_matrix[1][0]}, ${m.confusion_matrix[1][1]}]`
                            : '—'}
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          {m.status === 'active' ? (
                            <span className="text-[#C6FF4D] font-mono font-semibold">Active</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleActivateModel(m.id)}
                              className="px-3 py-1.5 text-xs font-medium bg-[#161D2B] hover:bg-[#C6FF4D] hover:text-[#080B12] text-[#F3F5F7] border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Activate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: DATASET UPLOAD & VALIDATION */}
        {tab === 'datasets' && (
          <div className="space-y-6">
            <form
              onSubmit={handleUploadDataset}
              className="bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-5"
            >
              <h2 className="font-display text-base font-semibold text-[#F3F5F7]">
                Upload Labeled CSV Corpus (WELFake / ISOT / LIAR / Custom)
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-mono text-[#929BAD] mb-1.5">
                    Dataset Name
                  </label>
                  <input
                    type="text"
                    value={datasetName}
                    onChange={(e) => setDatasetName(e.target.value)}
                    placeholder="e.g., ISOT Cleaned Split"
                    className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3 py-2 text-xs text-[#F3F5F7]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-[#929BAD] mb-1.5">
                    Format Preset
                  </label>
                  <select
                    value={datasetFormat}
                    onChange={(e) => setDatasetFormat(e.target.value)}
                    className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3 py-2 text-xs text-[#F3F5F7]"
                  >
                    <option value="welfake">WELFake CSV</option>
                    <option value="isot">ISOT Fake/True CSV</option>
                    <option value="liar">LIAR Dataset CSV</option>
                    <option value="custom">Custom Labeled CSV</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono text-[#929BAD] mb-1.5">
                    Numeric 0/1 Convention
                  </label>
                  <select
                    value={numericFakeValue}
                    onChange={(e) => setNumericFakeValue(e.target.value as '1' | '0')}
                    className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3 py-2 text-xs text-[#F3F5F7]"
                  >
                    <option value="1">1 = FAKE, 0 = REAL</option>
                    <option value="0">0 = FAKE, 1 = REAL (WELFake)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono text-[#929BAD] mb-1.5">
                    Select CSV File
                  </label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      setCsvFile(e.target.files?.[0] || null);
                      setCsvPreview(null);
                    }}
                    className="w-full text-xs text-[#929BAD] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#161D2B] file:text-[#F3F5F7] cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!csvFile || uploading}
                  onClick={() => handleInspectCsv(false)}
                  className="px-4 py-2 text-xs font-medium bg-[#161D2B] hover:bg-white/10 text-[#F3F5F7] border border-white/10 rounded-xl whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  Inspect & Auto-Detect Columns
                </button>
                <button
                  type="submit"
                  disabled={!csvFile || uploading}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold bg-[#C6FF4D] hover:bg-[#d5ff7a] text-[#080B12] rounded-xl whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploading ? 'Processing...' : 'Validate & Save Dataset'}</span>
                </button>
              </div>

              {csvPreview && (
                <div className="p-4 rounded-xl bg-[#080B12]/90 border border-[#28DFFF]/25 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono">
                    <div>
                      <span className="text-[#929BAD] block">Valid Rows</span>
                      <span className="text-[#F3F5F7] font-semibold">{csvPreview.valid_rows}</span>
                    </div>
                    <div>
                      <span className="text-[#929BAD] block">FAKE Class</span>
                      <span className="text-[#FF647C] font-semibold">{csvPreview.fake_count}</span>
                    </div>
                    <div>
                      <span className="text-[#929BAD] block">REAL Class</span>
                      <span className="text-[#C6FF4D] font-semibold">{csvPreview.real_count}</span>
                    </div>
                    <div>
                      <span className="text-[#929BAD] block">Duplicates Removed</span>
                      <span className="text-[#9566FF]">{csvPreview.duplicates_removed}</span>
                    </div>
                    <div>
                      <span className="text-[#929BAD] block">Missing Dropped</span>
                      <span className="text-[#929BAD]">{csvPreview.missing_removed}</span>
                    </div>
                  </div>

                  {/* Manual Column Mapping */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-white/10 text-xs">
                    <div>
                      <label className="block text-[#929BAD] mb-1">Title Column (Optional)</label>
                      <select
                        value={titleCol}
                        onChange={(e) => setTitleCol(e.target.value)}
                        className="w-full bg-[#101522] border border-white/15 rounded-lg px-2.5 py-1.5 text-[#F3F5F7]"
                      >
                        <option value="">None</option>
                        {csvPreview.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[#929BAD] mb-1">Article Text Column</label>
                      <select
                        value={textCol}
                        onChange={(e) => setTextCol(e.target.value)}
                        className="w-full bg-[#101522] border border-white/15 rounded-lg px-2.5 py-1.5 text-[#F3F5F7]"
                      >
                        {csvPreview.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[#929BAD] mb-1">Label Column</label>
                      <select
                        value={labelCol}
                        onChange={(e) => setLabelCol(e.target.value)}
                        className="w-full bg-[#101522] border border-white/15 rounded-lg px-2.5 py-1.5 text-[#F3F5F7]"
                      >
                        {csvPreview.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </form>

            <div className="bg-[#101522]/90 border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/10">
                <h2 className="font-display text-base font-semibold text-[#F3F5F7]">
                  Registered Datasets
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[#929BAD] font-mono">
                      <th className="py-3 px-5">Name</th>
                      <th className="py-3 px-3">Format</th>
                      <th className="py-3 px-3 text-right">Valid Rows</th>
                      <th className="py-3 px-3 text-right">FAKE / REAL</th>
                      <th className="py-3 px-3 text-right">Cleaned</th>
                      <th className="py-3 px-5 text-right">Uploaded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {datasets.map((d) => (
                      <tr key={d.id} className="hover:bg-white/[0.02]">
                        <td className="py-3.5 px-5 font-medium text-[#F3F5F7]">{d.name}</td>
                        <td className="py-3.5 px-3 font-mono uppercase text-[#28DFFF]">
                          {d.dataset_format}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#F3F5F7]">
                          {d.record_count}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#929BAD]">
                          {d.fake_count} / {d.real_count}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono text-[#929BAD]">
                          {d.duplicates_removed} dup · {d.missing_removed} miss
                        </td>
                        <td className="py-3.5 px-5 text-right font-mono text-[#929BAD]">
                          {new Date(d.uploaded_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: USER MANAGEMENT */}
        {tab === 'users' && (
          <div className="bg-[#101522]/90 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="font-display text-base font-semibold text-[#F3F5F7]">
                Registered Users & RBAC
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[#929BAD] font-mono">
                    <th className="py-3 px-5">User</th>
                    <th className="py-3 px-3">Email</th>
                    <th className="py-3 px-3 text-right">Analyses</th>
                    <th className="py-3 px-3">Role</th>
                    <th className="py-3 px-5 text-right">Permissions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 px-5 font-medium text-[#F3F5F7]">{u.full_name}</td>
                      <td className="py-3.5 px-3 font-mono text-[#929BAD]">{u.email}</td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#F3F5F7]">
                        {u.analysis_count}
                      </td>
                      <td className="py-3.5 px-3 font-mono uppercase text-[#28DFFF]">{u.role}</td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            handleRoleToggle(u.id, u.role === 'admin' ? 'user' : 'admin')
                          }
                          className="px-3 py-1.5 bg-[#161D2B] hover:bg-white/10 text-[#F3F5F7] border border-white/10 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {u.role === 'admin' ? 'Set User' : 'Promote Admin'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: FEEDBACK MODERATION */}
        {tab === 'feedback' && (
          <div className="bg-[#101522]/90 border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-[#F3F5F7]">
                Feedback Moderation Queue
              </h2>
              <span className="text-xs font-mono text-[#929BAD]">
                Isolated from ML training datasets
              </span>
            </div>
            {feedback.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#929BAD]">
                No user feedback submissions yet.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {feedback.map((f) => (
                  <div
                    key={f.id}
                    className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[#929BAD]">
                        <span className="text-[#F3F5F7]">{f.user_email}</span>
                        <span>·</span>
                        <span>{f.feedback_type}</span>
                        <span>·</span>
                        <span>Rating: {f.rating ?? 'N/A'}/5</span>
                        <span>·</span>
                        <span className="text-[#28DFFF] uppercase">{f.moderation_status}</span>
                      </div>
                      <p className="text-sm font-medium text-[#F3F5F7]">{f.headline}</p>
                      {f.comments && <p className="text-xs text-[#929BAD]">{f.comments}</p>}
                      {f.reference_url && (
                        <a
                          href={f.reference_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[#28DFFF] hover:underline font-mono"
                        >
                          {f.reference_url}
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleFeedbackModeration(f.id, 'reviewed')}
                        className="px-3 py-1.5 text-xs bg-[#C6FF4D]/15 hover:bg-[#C6FF4D]/25 text-[#C6FF4D] border border-[#C6FF4D]/30 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Mark Reviewed
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedbackModeration(f.id, 'dismissed')}
                        className="px-3 py-1.5 text-xs bg-[#161D2B] hover:bg-white/10 text-[#929BAD] border border-white/10 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: MONITORING & SYSTEM HEALTH */}
        {tab === 'monitoring' && (
          <div className="space-y-6">
            {system && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div className="bg-[#101522]/90 border border-white/10 rounded-2xl p-4">
                  <span className="text-[#929BAD] font-mono block">Total Users / Analyses</span>
                  <span className="text-xl font-mono font-semibold text-[#F3F5F7] mt-1 block tabular-nums">
                    {system.total_users} / {system.total_analyses}
                  </span>
                </div>
                <div className="bg-[#101522]/90 border border-white/10 rounded-2xl p-4">
                  <span className="text-[#929BAD] font-mono block">Datasets / Models</span>
                  <span className="text-xl font-mono font-semibold text-[#F3F5F7] mt-1 block tabular-nums">
                    {system.total_datasets} / {system.total_models}
                  </span>
                </div>
                <div className="bg-[#101522]/90 border border-white/10 rounded-2xl p-4">
                  <span className="text-[#929BAD] font-mono block">
                    Fact-Check Search Grounding
                  </span>
                  <span className="text-sm font-mono font-semibold text-[#28DFFF] mt-1.5 block">
                    {system.gemini_grounding_configured ? 'Configured' : 'Not Configured'}
                  </span>
                </div>
                <div className="bg-[#101522]/90 border border-white/10 rounded-2xl p-4">
                  <span className="text-[#929BAD] font-mono block">Supabase Cloud Sync</span>
                  <span className="text-sm font-mono font-semibold text-[#C6FF4D] mt-1.5 block">
                    {system.supabase_configured ? 'Connected' : 'Local SQLite Active'}
                  </span>
                </div>
              </div>
            )}

            <div className="bg-[#101522]/90 border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-white/10">
                <h2 className="font-display text-base font-semibold text-[#F3F5F7]">
                  Global Analysis Monitoring
                </h2>
              </div>
              {analyses.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#929BAD]">
                  No analyses recorded across users yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-[#929BAD] font-mono">
                        <th className="py-3 px-5">User</th>
                        <th className="py-3 px-3">Headline</th>
                        <th className="py-3 px-3">Prediction</th>
                        <th className="py-3 px-3 text-right">Confidence</th>
                        <th className="py-3 px-5 text-right">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {analyses.map((a) => (
                        <tr key={a.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-5 font-mono text-[#929BAD]">{a.user_email}</td>
                          <td className="py-3 px-3 text-[#F3F5F7] max-w-sm truncate">
                            {a.headline}
                          </td>
                          <td className="py-3 px-3">
                            <PredictionBadge prediction={a.prediction} size="sm" />
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-[#F3F5F7]">
                            {(a.confidence * 100).toFixed(1)}%
                          </td>
                          <td className="py-3 px-5 text-right font-mono text-[#929BAD]">
                            {new Date(a.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </WorkspaceLayout>
  );
}

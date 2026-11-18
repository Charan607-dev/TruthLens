import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  HelpCircle,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import { AnimatedCounter } from '../components/AnimatedCounter';
import { PredictionBadge } from '../components/PredictionBadge';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import { HistoryItem } from '../types';

interface DashboardStatsResponse {
  totals: {
    total: number;
    fake: number;
    real: number;
    uncertain: number;
  };
  daily_activity: Array<{
    day: string;
    total: number;
    fake: number;
    real: number;
    uncertain: number;
  }>;
  recent_analyses: HistoryItem[];
  active_model: {
    id: string;
    model_name: string;
    algorithm: string;
    version: string;
    accuracy: number;
    precision_score: number;
    recall_score: number;
    f1_score: number;
    roc_auc: number;
    dataset_name: string;
    record_count: number;
    trained_at: string;
  } | null;
}

export function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<DashboardStatsResponse>('/api/dashboard/stats')
      .then((res) => setStats(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  const distributionData = stats
    ? [
        { name: 'REAL', count: stats.totals.real, color: '#C6FF4D' },
        { name: 'FAKE', count: stats.totals.fake, color: '#FF647C' },
        { name: 'UNCERTAIN', count: stats.totals.uncertain, color: '#9566FF' },
      ]
    : [];

  const totalSafe = stats ? Math.max(1, stats.totals.total) : 1;
  const realPct = stats ? (stats.totals.real / totalSafe) * 100 : 0;
  const fakePct = stats ? (stats.totals.fake / totalSafe) * 100 : 0;
  const uncPct = stats ? (stats.totals.uncertain / totalSafe) * 100 : 0;

  return (
    <WorkspaceLayout>
      <div className="space-y-6">
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-mono text-[#28DFFF]">
              Welcome back, {user?.full_name || 'Analyst'}
            </p>
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-[#F3F5F7]">
              Your Intelligence Overview
            </h1>
            <p className="text-sm text-[#929BAD]">
              Live verification metrics, prediction distributions, and active classifier benchmarks.
            </p>
          </div>
          <Link
            to="/analyze"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            <ScanSearch className="w-4 h-4" />
            <span>Start New Analysis</span>
          </Link>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-[#FF647C]/12 border border-[#FF647C]/30 text-sm text-[#FFB3BF]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 h-44 bg-[#101522]/70 border border-white/10 rounded-2xl animate-pulse" />
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-44 bg-[#101522]/70 border border-white/10 rounded-2xl animate-pulse"
                />
              ))}
            </div>
          </div>
        ) : stats ? (
          <>
            {/* Asymmetric Top Bento Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Featured Total Analysed Card */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className="lg:col-span-5 bg-[#101522]/90 border border-white/12 rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 95% 10%, rgba(40,223,255,0.12), transparent 55%)',
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-mono text-[#929BAD]">Total Articles Analysed</p>
                    <p className="text-4xl sm:text-5xl font-display font-bold text-[#F3F5F7] mt-2">
                      <AnimatedCounter value={stats.totals.total} />
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#161D2B] border border-white/10 text-[#28DFFF]">
                    <ScanSearch className="w-5 h-5" />
                  </div>
                </div>

                {/* Proportional Breakdown Bar */}
                <div className="pt-6 space-y-2.5">
                  <div className="h-2 w-full bg-[#080B12] rounded-full overflow-hidden flex border border-white/8">
                    {stats.totals.total > 0 && (
                      <>
                        <div style={{ width: `${realPct}%` }} className="bg-[#C6FF4D]" />
                        <div style={{ width: `${fakePct}%` }} className="bg-[#FF647C]" />
                        <div style={{ width: `${uncPct}%` }} className="bg-[#9566FF]" />
                      </>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-[#929BAD]">
                    <span>REAL {realPct.toFixed(0)}%</span>
                    <span>FAKE {fakePct.toFixed(0)}%</span>
                    <span>UNCERTAIN {uncPct.toFixed(0)}%</span>
                  </div>
                </div>
              </motion.div>

              {/* Three Asymmetrical Verdict Cards */}
              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.05 }}
                  className="bg-[#101522]/90 border border-white/10 hover:border-[#C6FF4D]/35 rounded-2xl p-5 flex flex-col justify-between transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#C6FF4D]">Real Predictions</span>
                    <CheckCircle2 className="w-4 h-4 text-[#C6FF4D]" />
                  </div>
                  <div className="my-3">
                    <p className="text-3xl font-bold text-[#F3F5F7]">
                      <AnimatedCounter value={stats.totals.real} />
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-1 bg-[#080B12] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#C6FF4D]"
                        style={{ width: `${Math.max(stats.totals.real > 0 ? 8 : 0, realPct)}%` }}
                      />
                    </div>
                    <p className="text-[11px] font-mono text-[#929BAD]">
                      {realPct.toFixed(1)}% of verified corpus
                    </p>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.1 }}
                  className="bg-[#101522]/90 border border-white/10 hover:border-[#FF647C]/35 rounded-2xl p-5 flex flex-col justify-between transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#FF647C]">Fake Predictions</span>
                    <AlertTriangle className="w-4 h-4 text-[#FF647C]" />
                  </div>
                  <div className="my-3">
                    <p className="text-3xl font-bold text-[#F3F5F7]">
                      <AnimatedCounter value={stats.totals.fake} />
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-1 bg-[#080B12] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#FF647C]"
                        style={{ width: `${Math.max(stats.totals.fake > 0 ? 8 : 0, fakePct)}%` }}
                      />
                    </div>
                    <p className="text-[11px] font-mono text-[#929BAD]">
                      {fakePct.toFixed(1)}% flagged signals
                    </p>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.15 }}
                  className="bg-[#101522]/90 border border-white/10 hover:border-[#9566FF]/35 rounded-2xl p-5 flex flex-col justify-between transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#C4A8FF]">Uncertain Results</span>
                    <HelpCircle className="w-4 h-4 text-[#9566FF]" />
                  </div>
                  <div className="my-3">
                    <p className="text-3xl font-bold text-[#F3F5F7]">
                      <AnimatedCounter value={stats.totals.uncertain} />
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-1 bg-[#080B12] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#9566FF]"
                        style={{ width: `${Math.max(stats.totals.uncertain > 0 ? 8 : 0, uncPct)}%` }}
                      />
                    </div>
                    <p className="text-[11px] font-mono text-[#929BAD]">
                      {uncPct.toFixed(1)}% below threshold
                    </p>
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Charts Row (7:5 Asymmetric Split) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-display font-semibold text-[#F3F5F7]">
                      Analysis Trends
                    </h2>
                    <p className="text-xs text-[#929BAD]">Daily submissions over recent sessions</p>
                  </div>
                  <span className="text-xs font-mono text-[#28DFFF]">Timeline</span>
                </div>

                {stats.daily_activity.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-center space-y-3 bg-[#080B12]/60 rounded-xl border border-white/8">
                    <p className="text-sm text-[#929BAD]">No analysis activity recorded yet.</p>
                    <Link
                      to="/analyze"
                      className="px-4 py-2 text-xs font-semibold bg-[#C6FF4D] text-[#080B12] rounded-lg"
                    >
                      Run First Analysis
                    </Link>
                  </div>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stats.daily_activity}>
                        <defs>
                          <linearGradient id="tlCyanGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#28DFFF" stopOpacity={0.38} />
                            <stop offset="95%" stopColor="#28DFFF" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="day" stroke="#929BAD" fontSize={11} />
                        <YAxis allowDecimals={false} stroke="#929BAD" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#161D2B',
                            border: '1px solid rgba(255,255,255,0.14)',
                            borderRadius: '10px',
                            fontSize: '12px',
                            color: '#F3F5F7',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="total"
                          stroke="#28DFFF"
                          strokeWidth={2.2}
                          fillOpacity={1}
                          fill="url(#tlCyanGrad)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="lg:col-span-5 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-display font-semibold text-[#F3F5F7]">
                      Prediction Distribution
                    </h2>
                    <p className="text-xs text-[#929BAD]">Classification verdict volume</p>
                  </div>
                  <span className="text-xs font-mono text-[#929BAD]">By Class</span>
                </div>

                {stats.totals.total === 0 ? (
                  <div className="h-64 flex items-center justify-center bg-[#080B12]/60 rounded-xl border border-white/8 text-sm text-[#929BAD]">
                    Submit an article to populate distribution metrics.
                  </div>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={distributionData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="name" stroke="#929BAD" fontSize={11} />
                        <YAxis allowDecimals={false} stroke="#929BAD" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#161D2B',
                            border: '1px solid rgba(255,255,255,0.14)',
                            borderRadius: '10px',
                            fontSize: '12px',
                            color: '#F3F5F7',
                          }}
                        />
                        <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                          {distributionData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* Active Model Performance & Recent Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-4 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-display font-semibold text-[#F3F5F7] flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-[#9566FF]" />
                    <span>Model Performance</span>
                  </h2>
                  {user?.role === 'admin' && (
                    <Link to="/admin" className="text-xs text-[#28DFFF] hover:underline">
                      Manage
                    </Link>
                  )}
                </div>

                {stats.active_model ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-[#F3F5F7]">
                        {stats.active_model.model_name}
                      </p>
                      <p className="text-xs font-mono text-[#929BAD] mt-0.5">
                        {stats.active_model.version} · {stats.active_model.dataset_name} (
                        {stats.active_model.record_count} rows)
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-[#080B12]/75 border border-white/8">
                        <span className="text-[#929BAD] block">Accuracy</span>
                        <span className="font-mono text-lg font-bold text-[#F3F5F7]">
                          {(stats.active_model.accuracy * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-[#080B12]/75 border border-white/8">
                        <span className="text-[#929BAD] block">F1-Score</span>
                        <span className="font-mono text-lg font-bold text-[#C6FF4D]">
                          {(stats.active_model.f1_score * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-[#080B12]/75 border border-white/8">
                        <span className="text-[#929BAD] block">Precision</span>
                        <span className="font-mono text-lg font-bold text-[#28DFFF]">
                          {(stats.active_model.precision_score * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-[#080B12]/75 border border-white/8">
                        <span className="text-[#929BAD] block">ROC-AUC</span>
                        <span className="font-mono text-lg font-bold text-[#F3F5F7]">
                          {stats.active_model.roc_auc.toFixed(3)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-[#FF647C]/10 border border-[#FF647C]/30 text-xs text-[#FFB3BF]">
                    Model not trained. No active ML classifier is deployed.
                  </div>
                )}
              </div>

              <div className="lg:col-span-8 bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-display font-semibold text-[#F3F5F7]">
                    Latest Verification Activity
                  </h2>
                  <Link
                    to="/history"
                    className="inline-flex items-center gap-1 text-xs text-[#28DFFF] hover:underline"
                  >
                    <span>View all history</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {stats.recent_analyses.length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <p className="text-sm text-[#929BAD]">
                      No saved analyses yet. Run a headline, article, or URL check to populate your intelligence feed.
                    </p>
                    <Link
                      to="/analyze"
                      className="inline-block px-4 py-2 text-xs font-semibold bg-[#C6FF4D] text-[#080B12] rounded-lg"
                    >
                      Open News Analyzer
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y divide-white/8">
                    {stats.recent_analyses.map((item) => (
                      <div
                        key={item.id}
                        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02] px-2 rounded-lg transition-colors"
                      >
                        <div className="min-w-0 space-y-1">
                          <Link
                            to={`/history/${item.id}`}
                            className="text-sm font-medium text-[#F3F5F7] hover:text-[#28DFFF] line-clamp-1"
                          >
                            {item.headline}
                          </Link>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#929BAD]">
                            <span className="uppercase">{item.input_mode}</span>
                            <span>·</span>
                            <span>{new Date(item.created_at).toLocaleString()}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <PredictionBadge prediction={item.prediction} size="sm" />
                          <span className="text-xs font-mono tabular-nums text-[#F3F5F7] w-12 text-right">
                            {(item.confidence * 100).toFixed(1)}%
                          </span>
                          <Link
                            to={`/explainability?id=${item.id}`}
                            title="Inspect AI Explainability"
                            className="p-1.5 rounded-lg bg-[#161D2B] border border-white/10 text-[#929BAD] hover:text-[#28DFFF]"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </WorkspaceLayout>
  );
}

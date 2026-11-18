import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  ExternalLink,
  MessageSquarePlus,
  Send,
  ShieldAlert,
  Star,
} from 'lucide-react';
import { PredictionBadge } from '../components/PredictionBadge';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { apiRequest } from '../lib/api';
import { HistoryItem } from '../types';

const FEEDBACK_TYPES = [
  { id: 'misclassification', label: 'Suspected Misclassification' },
  { id: 'helpful_explanation', label: 'Helpful AI Explanation' },
  { id: 'source_mismatch', label: 'Source Metadata Mismatch' },
  { id: 'fact_check_tip', label: 'Verification Reference Tip' },
];

export function FeedbackPage() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [feedbackType, setFeedbackType] = useState('misclassification');
  const [rating, setRating] = useState<number>(4);
  const [comments, setComments] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    apiRequest<{ items: HistoryItem[] }>('/api/history')
      .then((res) => {
        setHistory(res.items);
        if (res.items.length > 0) {
          setSelectedId(res.items[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectedItem = history.find((item) => item.id === selectedId) || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      setStatus({ ok: false, msg: 'Please select an analyzed article before submitting.' });
      return;
    }
    setSubmitting(true);
    setStatus(null);
    try {
      await apiRequest('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          analysis_id: selectedId,
          feedback_type: feedbackType,
          rating,
          comments,
          reference_url: referenceUrl.trim() || undefined,
        }),
      });
      setStatus({
        ok: true,
        msg: 'Feedback recorded in the moderation queue for human review.',
      });
      setComments('');
      setReferenceUrl('');
    } catch (err) {
      setStatus({
        ok: false,
        msg: err instanceof Error ? err.message : 'Unable to submit feedback.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WorkspaceLayout>
      <div className="max-w-4xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#28DFFF]">
              Human-in-the-Loop Audit
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F3F5F7] mt-1">
              Reviewer Feedback & Quality Audit
            </h1>
            <p className="text-sm text-[#929BAD] mt-1">
              Flag suspected misclassifications, annotate source metadata issues, or attach
              primary verification links for human moderators.
            </p>
          </div>
          <Link
            to="/analyze"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#d5ff7a] rounded-xl transition-colors whitespace-nowrap shrink-0"
          >
            New Investigation
          </Link>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-6"
        >
          {loading ? (
            <div className="py-12 text-center text-sm font-mono text-[#929BAD]">
              Loading your verification archive...
            </div>
          ) : history.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <MessageSquarePlus className="w-8 h-8 text-[#9566FF] mx-auto" />
              <p className="text-sm text-[#F3F5F7] font-medium">
                No verified articles available to review yet.
              </p>
              <p className="text-xs text-[#929BAD]">
                Run an analysis first, then return here to annotate model accuracy or cite sources.
              </p>
              <Link
                to="/analyze"
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] rounded-xl"
              >
                Open News Analyzer
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-mono uppercase tracking-[0.14em] text-[#929BAD] mb-2">
                  Target Analysis Dossier
                </label>
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
                >
                  {history.map((item) => (
                    <option key={item.id} value={item.id}>
                      [{item.prediction} · {(item.confidence * 100).toFixed(0)}%] {item.headline}
                    </option>
                  ))}
                </select>
              </div>

              {selectedItem && (
                <div className="bg-[#161D2B]/80 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2.5 text-xs font-mono text-[#929BAD]">
                      <PredictionBadge prediction={selectedItem.prediction} size="sm" />
                      <span className="tabular-nums text-[#F3F5F7]">
                        {(selectedItem.confidence * 100).toFixed(1)}%
                      </span>
                      <span>·</span>
                      <span>
                        {selectedItem.model_name} ({selectedItem.model_version})
                      </span>
                    </div>
                    <p className="text-sm text-[#F3F5F7] font-medium truncate">
                      {selectedItem.headline}
                    </p>
                  </div>
                  <Link
                    to={`/history/${selectedItem.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-mono text-[#28DFFF] hover:underline whitespace-nowrap shrink-0"
                  >
                    <span>Inspect Full Report</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-mono uppercase tracking-[0.14em] text-[#929BAD] mb-2">
                    Feedback Category
                  </label>
                  <select
                    value={feedbackType}
                    onChange={(e) => setFeedbackType(e.target.value)}
                    className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
                  >
                    {FEEDBACK_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase tracking-[0.14em] text-[#929BAD] mb-2">
                    Explanation & Verdict Quality ({rating}/5)
                  </label>
                  <div className="flex items-center gap-2 h-[42px] px-3 bg-[#080B12] border border-white/15 rounded-xl">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        aria-label={`Rate ${star} stars`}
                        className="p-1 rounded-md hover:bg-white/5 cursor-pointer transition-colors"
                      >
                        <Star
                          className={`w-4 h-4 ${
                            star <= rating
                              ? 'text-[#C6FF4D] fill-[#C6FF4D]'
                              : 'text-[#929BAD]/40'
                          }`}
                        />
                      </button>
                    ))}
                    <span className="ml-auto text-xs font-mono text-[#929BAD]">
                      {rating >= 4 ? 'Strong' : rating === 3 ? 'Mixed' : 'Needs Review'}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-[0.14em] text-[#929BAD] mb-2">
                  Reviewer Observations
                </label>
                <textarea
                  rows={4}
                  required
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Describe why the classification, confidence score, or extracted explanation should be reviewed..."
                  className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-3 text-sm text-[#F3F5F7] placeholder:text-[#929BAD]/60 focus:outline-none focus:border-[#28DFFF]"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-[0.14em] text-[#929BAD] mb-2">
                  Corroborating Reference URL (Optional)
                </label>
                <input
                  type="url"
                  value={referenceUrl}
                  onChange={(e) => setReferenceUrl(e.target.value)}
                  placeholder="https://reuters.com/... or https://apnews.com/..."
                  className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm font-mono text-[#F3F5F7] placeholder:text-[#929BAD]/60 focus:outline-none focus:border-[#28DFFF]"
                />
              </div>

              {status && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
                    status.ok
                      ? 'bg-[#C6FF4D]/10 border-[#C6FF4D]/30 text-[#C6FF4D]'
                      : 'bg-[#FF647C]/10 border-[#FF647C]/30 text-[#FF647C]'
                  }`}
                >
                  {status.ok ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                  )}
                  <span>{status.msg}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-white/10">
                <p className="text-xs text-[#929BAD]">
                  Note: User feedback is quarantined in the admin moderation queue and never
                  automatically alters live model weights without dataset verification.
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#d5ff7a] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Submitting...' : 'Submit Feedback'}</span>
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </WorkspaceLayout>
  );
}

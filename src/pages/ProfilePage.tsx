import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { CheckCircle2, KeyRound, ShieldAlert, Sliders, UserCheck } from 'lucide-react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api';
import { User } from '../types';

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [defaultThreshold, setDefaultThreshold] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('truthlens_default_threshold');
      return saved ? Number(saved) : 0.62;
    } catch {
      return 0.62;
    }
  });
  const [thresholdNotice, setThresholdNotice] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const res = await apiRequest<{ user: User }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ full_name: fullName }),
      });
      setUser(res.user);
      setStatus({ ok: true, msg: 'Account profile saved successfully.' });
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Update failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveThreshold = (value: number) => {
    setDefaultThreshold(value);
    try {
      localStorage.setItem('truthlens_default_threshold', String(value));
      setThresholdNotice(
        `Default confidence threshold set to ${Math.round(value * 100)}% for new analyses.`
      );
    } catch {
      setThresholdNotice('Unable to store browser preference.');
    }
  };

  return (
    <WorkspaceLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#28DFFF]">
            Workspace Preferences
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F3F5F7] mt-1">
            Account & Analyzer Settings
          </h1>
          <p className="text-sm text-[#929BAD] mt-1">
            Manage your researcher identity, security credentials, and default inference
            thresholds.
          </p>
        </div>

        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          onSubmit={handleSave}
          className="bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs bg-[#080B12]/80 border border-white/10 rounded-xl p-4">
            <div>
              <span className="text-[#929BAD] font-mono uppercase tracking-[0.12em] block">
                Email Address
              </span>
              <span className="text-[#F3F5F7] font-mono mt-1 block truncate">{user?.email}</span>
            </div>
            <div>
              <span className="text-[#929BAD] font-mono uppercase tracking-[0.12em] block">
                Access Role
              </span>
              <span className="text-[#28DFFF] font-mono uppercase font-semibold mt-1 block">
                {user?.role}
              </span>
            </div>
            <div>
              <span className="text-[#929BAD] font-mono uppercase tracking-[0.12em] block">
                Member Since
              </span>
              <span className="text-[#F3F5F7] font-mono mt-1 block">
                {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-[0.14em] text-[#929BAD] mb-2">
              Full Name
            </label>
            <input
              type="text"
              required
              minLength={2}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-[#080B12] border border-white/15 rounded-xl px-4 py-2.5 text-sm text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
            />
          </div>

          {status && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
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

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-white/10">
            <Link
              to="/forgot-password"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-[#28DFFF] hover:underline whitespace-nowrap shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Reset Account Password</span>
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#d5ff7a] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <UserCheck className="w-4 h-4" />
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </motion.form>

        {/* Calibration / Uncertainty Threshold Default */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="bg-[#101522]/90 border border-white/10 rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Sliders className="w-4 h-4 text-[#9566FF]" />
              <h2 className="font-display text-base font-semibold text-[#F3F5F7]">
                Default Confidence Abstention Threshold
              </h2>
            </div>
            <span className="font-mono text-sm font-semibold tabular-nums text-[#C6FF4D]">
              {Math.round(defaultThreshold * 100)}%
            </span>
          </div>

          <p className="text-xs text-[#929BAD] leading-relaxed">
            Articles whose top class probability falls below this threshold are labeled{' '}
            <span className="font-mono text-[#9566FF]">UNCERTAIN</span> instead of committing to a
            binary REAL or FAKE verdict. Recommended calibration baseline: 62%.
          </p>

          <div className="space-y-2">
            <input
              type="range"
              min={0.5}
              max={0.85}
              step={0.01}
              value={defaultThreshold}
              onChange={(e) => handleSaveThreshold(Number(e.target.value))}
              className="w-full accent-[#C6FF4D] cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono text-[#929BAD]">
              <span>50% (Permissive)</span>
              <span>62% (Default)</span>
              <span>85% (Strict Verification)</span>
            </div>
          </div>

          {thresholdNotice && (
            <p className="text-xs font-mono text-[#28DFFF]">{thresholdNotice}</p>
          )}
        </motion.div>
      </div>
    </WorkspaceLayout>
  );
}

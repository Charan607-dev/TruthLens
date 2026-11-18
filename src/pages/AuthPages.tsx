import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, KeyRound, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { apiRequest } from '../lib/api';

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#080B12] text-[#F3F5F7] flex flex-col justify-center px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 tl-grid-bg opacity-45 pointer-events-none" />
      <div
        aria-hidden="true"
        className="absolute -top-32 left-1/3 w-[480px] h-[480px] rounded-full bg-[#28DFFF]/[0.07] blur-[130px] pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-0 right-1/4 w-[420px] h-[420px] rounded-full bg-[#9566FF]/[0.08] blur-[130px] pointer-events-none"
      />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 max-w-md w-full mx-auto space-y-6"
      >
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs text-[#929BAD] hover:text-[#F3F5F7] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Home</span>
          </Link>
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#C6FF4D] via-[#28DFFF] to-[#9566FF] flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-[#080B12]" />
            </div>
            <span className="font-display font-bold text-sm tracking-tight text-[#F3F5F7]">
              TRUTHLENS AI
            </span>
          </Link>
        </div>

        <div className="bg-[#101522]/90 backdrop-blur-xl border border-white/12 rounded-2xl p-6 sm:p-8 space-y-6 shadow-[0_24px_70px_rgba(0,0,0,0.6)]">
          <div>
            <p className="text-[11px] font-mono tracking-widest text-[#28DFFF] uppercase mb-1.5">
              See Beyond The Headline
            </p>
            <h1 className="text-2xl font-display font-bold text-[#F3F5F7]">{title}</h1>
            <p className="text-sm text-[#929BAD] mt-1">{subtitle}</p>
          </div>
          {children}
        </div>
      </motion.div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleInfo, setGoogleInfo] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl('/api/auth/google-status'))
      .then((r) => r.json())
      .then((d) => setGoogleInfo(d.message))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (role: 'admin' | 'user') => {
    if (role === 'admin') {
      setEmail('admin@truthlens.ai');
      setPassword('AdminTruth2026!');
    } else {
      setEmail('researcher@truthlens.ai');
      setPassword('Research2026!');
    }
  };

  return (
    <AuthShell
      title="Sign in to TruthLens AI"
      subtitle="Access the intelligence center, explainable ML diagnostics, and analysis history."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-[#FF647C]/12 border border-[#FF647C]/30 text-xs text-[#FFB3BF]">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-[#F3F5F7]/90 mb-1.5">
            Email Address
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
            placeholder="you@domain.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium text-[#F3F5F7]/90">Password</label>
            <Link to="/forgot-password" className="text-xs text-[#28DFFF] hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 text-sm font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div className="pt-4 border-t border-white/10 space-y-3">
        <p className="text-xs text-[#929BAD]">Quick Evaluation Accounts</p>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => quickFill('user')}
            className="px-3 py-2 text-xs font-medium bg-[#161D2B] hover:bg-white/10 border border-white/12 rounded-xl text-[#F3F5F7] cursor-pointer transition-colors"
          >
            Fill Researcher
          </button>
          <button
            type="button"
            onClick={() => quickFill('admin')}
            className="px-3 py-2 text-xs font-medium bg-[#161D2B] hover:bg-[#9566FF]/15 border border-[#9566FF]/35 rounded-xl text-[#F3F5F7] cursor-pointer transition-colors"
          >
            Fill Admin
          </button>
        </div>
        {googleInfo && (
          <p className="text-[11px] text-[#929BAD]/80 leading-relaxed">{googleInfo}</p>
        )}
      </div>

      <p className="text-xs text-center text-[#929BAD]">
        New to TruthLens AI?{' '}
        <Link to="/register" className="text-[#28DFFF] hover:underline font-medium">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(fullName, email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create TruthLens Account"
      subtitle="Register to verify news claims, inspect feature attribution, and export PDF dossiers."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-[#FF647C]/12 border border-[#FF647C]/30 text-xs text-[#FFB3BF]">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-[#F3F5F7]/90 mb-1.5">Full Name</label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
            placeholder="Alex Rivera"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#F3F5F7]/90 mb-1.5">
            Email Address
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
            placeholder="you@domain.com"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#F3F5F7]/90 mb-1.5">
            Password (minimum 8 characters)
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 text-sm font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
        >
          {loading ? 'Creating Account...' : 'Get Started'}
        </button>
      </form>

      <p className="text-xs text-center text-[#929BAD]">
        Already registered?{' '}
        <Link to="/login" className="text-[#28DFFF] hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string; dev_reset_token?: string }>(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        }
      );
      setMessage(res.message);
      if (res.dev_reset_token) {
        setTokenInput(res.dev_reset_token);
      }
      setStep('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: tokenInput, new_password: newPassword }),
      });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Password Recovery"
      subtitle="Generate a time-limited reset token and update your account credentials."
    >
      {message && (
        <div className="p-3 rounded-xl bg-[#C6FF4D]/10 border border-[#C6FF4D]/30 text-xs text-[#E5FFAB]">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-[#FF647C]/12 border border-[#FF647C]/30 text-xs text-[#FFB3BF]">
          {error}
        </div>
      )}

      {step === 'request' ? (
        <form onSubmit={handleRequest} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#F3F5F7]/90 mb-1.5">
              Account Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 text-sm font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-xl transition-colors cursor-pointer"
          >
            {loading ? 'Generating...' : 'Send Reset Token'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#F3F5F7]/90 mb-1.5">
              Reset Token
            </label>
            <input
              type="text"
              required
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-xs font-mono text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#F3F5F7]/90 mb-1.5">
              New Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-[#080B12] border border-white/15 rounded-xl px-3.5 py-2.5 text-sm text-[#F3F5F7] focus:outline-none focus:border-[#28DFFF]"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-[#080B12] bg-[#C6FF4D] hover:bg-[#D5FF75] rounded-xl transition-colors cursor-pointer"
          >
            <KeyRound className="w-4 h-4" />
            <span>{loading ? 'Updating...' : 'Reset Password'}</span>
          </button>
        </form>
      )}

      <p className="text-xs text-center text-[#929BAD]">
        <Link to="/login" className="text-[#28DFFF] hover:underline">
          Return to Sign In
        </Link>
      </p>
    </AuthShell>
  );
}

import { motion, useReducedMotion } from 'motion/react';
import { Activity, AlertTriangle, CheckCircle2, Cpu, HelpCircle, ShieldCheck } from 'lucide-react';

interface Props {
  activeModelName?: string;
  activeModelVersion?: string;
  onSelectFragment?: (sampleIndex: number) => void;
}

const FRAGMENTS = [
  {
    idx: 0,
    verdict: 'REAL' as const,
    score: '91.4%',
    headline: 'Federal Reserve maintains benchmark rate ahead of CPI report',
    source: 'Wire Institutional Reporting',
    pos: 'top-5 left-4 sm:left-6',
  },
  {
    idx: 1,
    verdict: 'FAKE' as const,
    score: '88.2%',
    headline: 'BREAKING BOMBSHELL: Secret overnight freeze on all accounts',
    source: 'Sensational Phrasing Signal',
    pos: 'bottom-20 right-3 sm:right-5',
  },
  {
    idx: 2,
    verdict: 'UNCERTAIN' as const,
    score: '56.0%',
    headline: 'Local council reviews quarterly road resurfacing proposals',
    source: 'Below 62% Confidence Guardrail',
    pos: 'bottom-5 left-4 sm:left-8',
  },
];

const PARTICLES = [
  { cx: 18, cy: 24, r: 2, color: '#28DFFF', dur: 4.5 },
  { cx: 82, cy: 20, r: 2.2, color: '#C6FF4D', dur: 5.2 },
  { cx: 78, cy: 66, r: 1.8, color: '#9566FF', dur: 4.0 },
  { cx: 24, cy: 76, r: 2, color: '#FF647C', dur: 5.8 },
  { cx: 52, cy: 14, r: 1.8, color: '#28DFFF', dur: 4.9 },
  { cx: 64, cy: 84, r: 2.2, color: '#C6FF4D', dur: 5.4 },
];

export function HeroIntelligenceVisual({
  activeModelName = 'TF-IDF + Logistic Regression',
  activeModelVersion = 'v1.0.0',
  onSelectFragment,
}: Props) {
  const reducedMotion = useReducedMotion();

  return (
    <div className="relative w-full min-h-[430px] lg:h-full rounded-2xl border border-white/12 bg-[#101522]/90 overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
      {/* Subtle grid and radial core aura */}
      <div className="absolute inset-0 tl-grid-bg opacity-65 pointer-events-none" />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(40,223,255,0.16),rgba(149,102,255,0.08)_42%,transparent_72%)] pointer-events-none"
      />

      {/* Network Topology & Moving Data Nodes */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none opacity-60"
        aria-hidden="true"
      >
        <line x1="20" y1="22" x2="50" y2="50" stroke="rgba(40,223,255,0.22)" strokeWidth="0.25" />
        <line x1="80" y1="22" x2="50" y2="50" stroke="rgba(198,255,77,0.22)" strokeWidth="0.25" />
        <line x1="78" y1="72" x2="50" y2="50" stroke="rgba(255,100,124,0.25)" strokeWidth="0.25" />
        <line x1="25" y1="78" x2="50" y2="50" stroke="rgba(149,102,255,0.25)" strokeWidth="0.25" />
        <line x1="20" y1="22" x2="80" y2="22" stroke="rgba(255,255,255,0.07)" strokeWidth="0.2" strokeDasharray="1 1" />
        <line x1="25" y1="78" x2="78" y2="72" stroke="rgba(255,255,255,0.07)" strokeWidth="0.2" strokeDasharray="1 1" />
        {PARTICLES.map((p, i) => (
          <motion.circle
            key={i}
            cx={p.cx}
            cy={p.cy}
            r={p.r * 0.45}
            fill={p.color}
            animate={
              reducedMotion
                ? undefined
                : {
                    opacity: [0.3, 0.95, 0.3],
                    scale: [1, 1.45, 1],
                  }
            }
            transition={{
              duration: p.dur,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.45,
            }}
          />
        ))}
      </svg>

      {/* Center Radar & Rotating Circular Data Rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center">
          {/* Outer dashed calibration ring */}
          <motion.svg
            viewBox="0 0 280 280"
            className="absolute inset-0 w-full h-full"
            animate={reducedMotion ? undefined : { rotate: 360 }}
            transition={{ duration: 34, repeat: Infinity, ease: 'linear' }}
          >
            <circle
              cx="140"
              cy="140"
              r="132"
              fill="none"
              stroke="rgba(40,223,255,0.24)"
              strokeWidth="1"
              strokeDasharray="6 8"
            />
            <circle
              cx="140"
              cy="140"
              r="116"
              fill="none"
              stroke="rgba(149,102,255,0.18)"
              strokeWidth="1"
            />
          </motion.svg>

          {/* Counter-rotating segmented arc ring */}
          <motion.svg
            viewBox="0 0 280 280"
            className="absolute inset-0 w-full h-full"
            animate={reducedMotion ? undefined : { rotate: -360 }}
            transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
          >
            <circle
              cx="140"
              cy="140"
              r="96"
              fill="none"
              stroke="rgba(198,255,77,0.28)"
              strokeWidth="2"
              strokeDasharray="48 90"
              strokeLinecap="round"
            />
            <circle
              cx="140"
              cy="140"
              r="76"
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
              strokeDasharray="3 5"
            />
          </motion.svg>

          {/* Radar sweep sector */}
          {!reducedMotion && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 6.5, repeat: Infinity, ease: 'linear' }}
              className="absolute w-64 h-64 rounded-full opacity-55"
              style={{
                background:
                  'conic-gradient(from 0deg, rgba(40,223,255,0.28) 0deg, rgba(40,223,255,0.02) 65deg, transparent 90deg)',
              }}
            />
          )}

          {/* Glowing AI Core */}
          <motion.div
            animate={
              reducedMotion
                ? undefined
                : { scale: [1, 1.06, 1], opacity: [0.9, 1, 0.9] }
            }
            transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
            className="relative z-10 w-24 h-24 rounded-full bg-[#080B12]/90 border border-[#28DFFF]/45 flex flex-col items-center justify-center shadow-[0_0_45px_rgba(40,223,255,0.32)]"
          >
            <Cpu className="w-7 h-7 text-[#28DFFF]" />
            <span className="mt-1 text-[10px] font-mono tracking-widest text-[#C6FF4D]">
              NLP CORE
            </span>
          </motion.div>
        </div>
      </div>

      {/* Animated Horizontal Scanning Line */}
      {!reducedMotion && (
        <motion.div
          aria-hidden="true"
          animate={{ y: ['0%', '430%'] }}
          transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut', repeatType: 'reverse' }}
          className="absolute left-0 right-0 top-0 h-20 pointer-events-none bg-gradient-to-b from-transparent via-[#28DFFF]/12 to-transparent border-b border-[#28DFFF]/35"
        />
      )}

      {/* Floating Headline Credibility Fragments */}
      {FRAGMENTS.map((frag, i) => {
        const isReal = frag.verdict === 'REAL';
        const isFake = frag.verdict === 'FAKE';
        const Icon = isReal ? CheckCircle2 : isFake ? AlertTriangle : HelpCircle;
        const accentCls = isReal
          ? 'text-[#C6FF4D] border-[#C6FF4D]/30'
          : isFake
            ? 'text-[#FF647C] border-[#FF647C]/35'
            : 'text-[#C4A8FF] border-[#9566FF]/35';

        return (
          <motion.button
            key={frag.verdict}
            type="button"
            onClick={() => onSelectFragment?.(frag.idx)}
            initial={{ opacity: 0, y: 10 }}
            animate={
              reducedMotion
                ? { opacity: 1, y: 0 }
                : { opacity: 1, y: [0, i % 2 === 0 ? -5 : 5, 0] }
            }
            transition={{
              opacity: { duration: 0.5, delay: 0.15 + i * 0.12 },
              y: { duration: 4.5 + i * 0.7, repeat: Infinity, ease: 'easeInOut' },
            }}
            className={`absolute ${frag.pos} z-20 max-w-[235px] text-left p-3 rounded-xl bg-[#080B12]/88 backdrop-blur-md border border-white/12 hover:border-[#28DFFF]/50 transition-colors cursor-pointer shadow-lg`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${accentCls}`}>
                <Icon className="w-3 h-3" />
                <span>{frag.verdict}</span>
              </span>
              <span className="text-[11px] font-mono tabular-nums text-[#F3F5F7]">
                {frag.score}
              </span>
            </div>
            <p className="text-[11px] font-medium text-[#F3F5F7] line-clamp-2 leading-snug">
              {frag.headline}
            </p>
            <p className="text-[10px] font-mono text-[#929BAD] mt-1 truncate">
              {frag.source}
            </p>
          </motion.button>
        );
      })}

      {/* Bottom Active Engine Telemetry Strip */}
      <div className="absolute bottom-3 right-4 z-20 hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-[#080B12]/90 border border-white/10 text-[11px] font-mono text-[#929BAD]">
        <ShieldCheck className="w-3.5 h-3.5 text-[#28DFFF]" />
        <span className="text-[#F3F5F7]">{activeModelName}</span>
        <span>·</span>
        <span>{activeModelVersion}</span>
        <span>·</span>
        <span className="inline-flex items-center gap-1 text-[#C6FF4D]">
          <Activity className="w-3 h-3" />
          Ready
        </span>
      </div>
    </div>
  );
}

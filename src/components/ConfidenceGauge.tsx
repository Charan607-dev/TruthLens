import { motion, useReducedMotion } from 'motion/react';

interface Props {
  confidence: number; // 0..1
  prediction: 'REAL' | 'FAKE' | 'UNCERTAIN';
  size?: number;
}

export function ConfidenceGauge({ confidence, prediction, size = 152 }: Props) {
  const reducedMotion = useReducedMotion();
  const pct = Math.max(0, Math.min(100, confidence * 100));
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);

  const palette = {
    REAL: {
      stroke: '#C6FF4D',
      glow: 'rgba(198, 255, 77, 0.35)',
      track: 'rgba(198, 255, 77, 0.12)',
      labelColor: 'text-[#C6FF4D]',
    },
    FAKE: {
      stroke: '#FF647C',
      glow: 'rgba(255, 100, 124, 0.35)',
      track: 'rgba(255, 100, 124, 0.12)',
      labelColor: 'text-[#FF647C]',
    },
    UNCERTAIN: {
      stroke: '#9566FF',
      glow: 'rgba(149, 102, 255, 0.35)',
      track: 'rgba(149, 102, 255, 0.14)',
      labelColor: 'text-[#C4A8FF]',
    },
  }[prediction];

  return (
    <div
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-label={`Model confidence ${pct.toFixed(1)} percent`}
      >
        <defs>
          <filter id={`gauge-glow-${prediction}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={palette.track}
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={palette.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: reducedMotion ? dashOffset : circumference }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: reducedMotion ? 0 : 0.9, ease: [0.16, 1, 0.3, 1] }}
          style={{ filter: `drop-shadow(0 0 8px ${palette.glow})` }}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-3xl font-mono font-bold tabular-nums text-[#F3F5F7]">
          {pct.toFixed(1)}%
        </span>
        <span className={`text-[11px] font-mono uppercase tracking-wider mt-0.5 ${palette.labelColor}`}>
          Confidence
        </span>
      </div>
    </div>
  );
}

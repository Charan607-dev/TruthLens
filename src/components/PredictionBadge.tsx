import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';

interface Props {
  prediction: 'REAL' | 'FAKE' | 'UNCERTAIN';
  size?: 'sm' | 'md' | 'lg';
}

export function PredictionBadge({ prediction, size = 'md' }: Props) {
  const config = {
    REAL: {
      label: 'REAL',
      icon: CheckCircle2,
      cls: 'text-[#C6FF4D] bg-[#C6FF4D]/10 border-[#C6FF4D]/30',
    },
    FAKE: {
      label: 'FAKE',
      icon: AlertTriangle,
      cls: 'text-[#FF647C] bg-[#FF647C]/12 border-[#FF647C]/35',
    },
    UNCERTAIN: {
      label: 'UNCERTAIN',
      icon: HelpCircle,
      cls: 'text-[#C4A8FF] bg-[#9566FF]/15 border-[#9566FF]/35',
    },
  }[prediction];

  const Icon = config.icon;
  const sizing =
    size === 'lg'
      ? 'px-3.5 py-1.5 text-sm gap-2'
      : size === 'sm'
        ? 'px-2.5 py-0.5 text-[11px] gap-1.5'
        : 'px-3 py-1 text-xs gap-1.5';

  return (
    <span
      className={`inline-flex items-center font-mono font-semibold tracking-wider border rounded-lg whitespace-nowrap shrink-0 ${config.cls} ${sizing}`}
    >
      <Icon className={size === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
      <span>{config.label}</span>
    </span>
  );
}

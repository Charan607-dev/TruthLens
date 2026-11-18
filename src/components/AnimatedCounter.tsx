import { useEffect, useState } from 'react';
import { animate } from 'motion';

interface Props {
  value: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
}

export function AnimatedCounter({ value, decimals = 0, suffix = '', duration = 0.7 }: Props) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate(latest) {
        setDisplay(latest);
      },
    });
    return () => controls.stop();
  }, [value, duration]);

  return (
    <span className="tabular-nums font-mono">
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

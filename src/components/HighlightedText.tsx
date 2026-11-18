import React from 'react';

interface TermInfo {
  term: string;
  direction: 'fake' | 'real';
  contribution: number;
}

interface Props {
  text: string;
  matchedTerms: TermInfo[];
}

export function HighlightedText({ text, matchedTerms }: Props) {
  if (!text) return null;
  if (!matchedTerms || matchedTerms.length === 0) {
    return <p className="text-sm text-[#F3F5F7]/90 leading-relaxed whitespace-pre-wrap">{text}</p>;
  }

  const termMap = new Map<string, TermInfo>();
  for (const item of matchedTerms) {
    termMap.set(item.term.toLowerCase(), item);
  }

  const sortedTerms = Array.from(termMap.keys()).sort((a, b) => b.length - a.length);
  const escaped = sortedTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) {
    return <p className="text-sm text-[#F3F5F7]/90 leading-relaxed whitespace-pre-wrap">{text}</p>;
  }

  const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const matchedStr = match[0];
    const info = termMap.get(matchedStr.toLowerCase());
    if (info) {
      const isFake = info.direction === 'fake';
      parts.push(
        <mark
          key={`hl-${idx++}`}
          title={`Feature "${info.term}" contribution: ${info.contribution > 0 ? '+' : ''}${info.contribution.toFixed(4)} (${isFake ? 'FAKE-correlated' : 'REAL-correlated'})`}
          className={
            isFake
              ? 'bg-[#FF647C]/20 text-[#FFB3BF] border-b border-[#FF647C]/70 px-1 py-0.5 rounded-xs transition-colors hover:bg-[#FF647C]/30'
              : 'bg-[#C6FF4D]/15 text-[#E5FFAB] border-b border-[#C6FF4D]/70 px-1 py-0.5 rounded-xs transition-colors hover:bg-[#C6FF4D]/25'
          }
        >
          {matchedStr}
        </mark>
      );
    } else {
      parts.push(matchedStr);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return (
    <div className="text-sm text-[#F3F5F7]/90 leading-relaxed whitespace-pre-wrap">
      {parts}
    </div>
  );
}

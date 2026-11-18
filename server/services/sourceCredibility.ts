export interface SourceCredibilityReport {
  domain: string | null;
  publisher_name: string | null;
  uses_https: boolean | null;
  author_detected: string | null;
  publication_date: string | null;
  transparency_signals: string[];
  known_profile: {
    status: 'verified_news_organization' | 'fact_checking_body' | 'satire_or_parody' | 'unrated_domain';
    summary: string;
    editorial_standards: string;
  };
  disclaimer: string;
}

interface KnownDomainEntry {
  publisher: string;
  status: 'verified_news_organization' | 'fact_checking_body' | 'satire_or_parody';
  standards: string;
  summary: string;
}

const KNOWN_PUBLISHERS: Record<string, KnownDomainEntry> = {
  'reuters.com': {
    publisher: 'Reuters',
    status: 'verified_news_organization',
    standards: 'International wire service adhering to Thomson Reuters Trust Principles.',
    summary: 'Established global news agency with documented editorial corrections policies.',
  },
  'apnews.com': {
    publisher: 'Associated Press',
    status: 'verified_news_organization',
    standards: 'Independent non-profit news cooperative with published AP News Values.',
    summary: 'Primary wire reporting organization with transparent sourcing guidelines.',
  },
  'bbc.com': {
    publisher: 'BBC News',
    status: 'verified_news_organization',
    standards: 'Public service broadcaster governed by editorial impartiality guidelines.',
    summary: 'Established international news organization.',
  },
  'bbc.co.uk': {
    publisher: 'BBC News',
    status: 'verified_news_organization',
    standards: 'Public service broadcaster governed by editorial impartiality guidelines.',
    summary: 'Established international news organization.',
  },
  'npr.org': {
    publisher: 'NPR',
    status: 'verified_news_organization',
    standards: 'Public radio newsroom with Ombudsman and published ethics handbook.',
    summary: 'Publicly funded journalism organization.',
  },
  'nature.com': {
    publisher: 'Nature Portfolio',
    status: 'verified_news_organization',
    standards: 'Peer-reviewed scientific journal and science news division.',
    summary: 'Recognized academic and scientific publishing institution.',
  },
  'theguardian.com': {
    publisher: 'The Guardian',
    status: 'verified_news_organization',
    standards: 'Independent editorial trust with public corrections column.',
    summary: 'Established international daily newspaper.',
  },
  'nytimes.com': {
    publisher: 'The New York Times',
    status: 'verified_news_organization',
    standards: 'Published Standards and Ethics guidelines with formal corrections desk.',
    summary: 'Established national and international newspaper.',
  },
  'snopes.com': {
    publisher: 'Snopes',
    status: 'fact_checking_body',
    standards: 'IFCN signatory independent fact-checking publication.',
    summary: 'Dedicated fact-checking outlet documenting primary citations.',
  },
  'politifact.com': {
    publisher: 'PolitiFact',
    status: 'fact_checking_body',
    standards: 'IFCN signatory fact-checking initiative operated by Poynter Institute.',
    summary: 'Dedicated claim-verification newsroom.',
  },
  'factcheck.org': {
    publisher: 'FactCheck.org',
    status: 'fact_checking_body',
    standards: 'Annenberg Public Policy Center nonpartisan fact-checking project.',
    summary: 'Academic non-profit claim verification organization.',
  },
  'theonion.com': {
    publisher: 'The Onion',
    status: 'satire_or_parody',
    standards: 'Explicitly self-described satirical news publication.',
    summary: 'Satire publication; articles are intentionally fictional parody.',
  },
  'babylonbee.com': {
    publisher: 'The Babylon Bee',
    status: 'satire_or_parody',
    standards: 'Explicitly self-described Christian/political satire website.',
    summary: 'Satire publication; articles are intentionally fictional parody.',
  },
};

export function analyzeSourceCredibility(params: {
  sourceUrl?: string | null;
  author?: string | null;
  publishedDate?: string | null;
  siteName?: string | null;
}): SourceCredibilityReport {
  const transparency_signals: string[] = [];
  let domain: string | null = null;
  let uses_https: boolean | null = null;

  if (params.sourceUrl) {
    try {
      const parsed = new URL(params.sourceUrl);
      domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
      uses_https = parsed.protocol === 'https:';
      if (uses_https) {
        transparency_signals.push('Encrypted HTTPS transport verified');
      } else {
        transparency_signals.push('Unencrypted HTTP transport');
      }
    } catch {
      domain = null;
    }
  }

  if (params.author) {
    transparency_signals.push(`Attributed author present: ${params.author}`);
  } else if (params.sourceUrl) {
    transparency_signals.push('No explicit author byline detected in HTML metadata');
  }

  if (params.publishedDate) {
    transparency_signals.push(`Publication timestamp detected: ${params.publishedDate}`);
  } else if (params.sourceUrl) {
    transparency_signals.push('No structured publication timestamp detected in HTML metadata');
  }

  let known_profile: SourceCredibilityReport['known_profile'] = {
    status: 'unrated_domain',
    summary: domain
      ? `Domain "${domain}" is not in the curated transparency reference registry. Unknown domains are NOT classified as fake.`
      : 'No source URL was provided; source credibility evaluation requires a publisher domain.',
    editorial_standards: 'Independent editorial review recommended.',
  };

  let publisher_name = params.siteName || domain;

  if (domain) {
    // Match exact domain or parent domain (e.g. uk.reuters.com -> reuters.com)
    const parts = domain.split('.');
    const candidates = [domain];
    if (parts.length > 2) {
      candidates.push(parts.slice(-2).join('.'));
      candidates.push(parts.slice(-3).join('.'));
    }

    for (const c of candidates) {
      const entry = KNOWN_PUBLISHERS[c];
      if (entry) {
        publisher_name = entry.publisher;
        known_profile = {
          status: entry.status,
          summary: entry.summary,
          editorial_standards: entry.standards,
        };
        transparency_signals.push(`Matched transparency registry: ${entry.publisher}`);
        break;
      }
    }
  }

  return {
    domain,
    publisher_name,
    uses_https,
    author_detected: params.author || null,
    publication_date: params.publishedDate || null,
    transparency_signals,
    known_profile,
    disclaimer:
      'Source credibility reflects publisher transparency indicators and reference listings only. Even reputable publishers can make errors, and unfamiliar domains can publish accurate reporting.',
  };
}

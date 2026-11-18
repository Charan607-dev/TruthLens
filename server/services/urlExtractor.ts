import dns from 'dns/promises';
import net from 'net';
import * as cheerio from 'cheerio';

export interface ExtractedUrlContent {
  url: string;
  domain: string;
  title: string;
  body: string;
  author: string | null;
  published_date: string | null;
  site_name: string | null;
  word_count: number;
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (!net.isIP(ip)) return true;

  // Handle IPv4-mapped IPv6 addresses
  const cleaned = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  if (net.isIPv4(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  // IPv6 checks
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return false;
}

export async function validateSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL format. Please provide a complete http:// or https:// address.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS protocols are permitted.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Access to local or internal network hosts is blocked for SSRF protection.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Direct requests to private or reserved IP ranges are not permitted.');
    }
  } else {
    let resolved: Array<{ address: string }>;
    try {
      resolved = await dns.lookup(host, { all: true });
    } catch {
      throw new Error(`Could not resolve domain "${host}". Check that the URL is reachable.`);
    }
    if (!resolved || resolved.length === 0) {
      throw new Error(`No DNS records found for "${host}".`);
    }
    for (const entry of resolved) {
      if (isPrivateOrReservedIp(entry.address)) {
        throw new Error('Resolved destination IP belongs to a restricted internal network.');
      }
    }
  }

  return parsed;
}

export async function fetchAndExtractArticle(rawUrl: string): Promise<ExtractedUrlContent> {
  const safeUrl = await validateSafePublicUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(safeUrl.toString(), {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'TruthLensAI-VerificationBot/1.0 (+https://truthlens.ai)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    if (msg.includes('abort')) {
      throw new Error('Request timed out after 10 seconds while fetching the target URL.');
    }
    throw new Error(`Unable to fetch URL: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }

  // Re-validate final redirect destination for SSRF safety
  if (response.url && response.url !== safeUrl.toString()) {
    await validateSafePublicUrl(response.url);
  }

  if (response.status === 401 || response.status === 402 || response.status === 403) {
    throw new Error(
      `Publisher returned HTTP ${response.status} (access restricted or paywalled). Paste the article text directly into Full Article mode instead.`
    );
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: Publisher responded with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new Error(`Unsupported content type "${contentType || 'unknown'}". Only HTML news pages can be extracted.`);
  }

  const html = await response.text();
  if (html.length > 2_500_000) {
    throw new Error('Fetched HTML document exceeds the 2.5 MB extraction safety limit.');
  }

  const $ = cheerio.load(html);

  // Strip non-content boilerplate and dangerous tags
  $('script, style, noscript, iframe, svg, nav, footer, aside, form, button, [role="banner"], [role="navigation"]').remove();

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('meta[name="twitter:title"]').attr('content')?.trim() ||
    $('h1').first().text().trim() ||
    $('title').text().trim() ||
    '';

  const author =
    $('meta[name="author"]').attr('content')?.trim() ||
    $('meta[property="article:author"]').attr('content')?.trim() ||
    $('[rel="author"]').first().text().trim() ||
    null;

  const published_date =
    $('meta[property="article:published_time"]').attr('content')?.trim() ||
    $('meta[name="pubdate"]').attr('content')?.trim() ||
    $('meta[name="date"]').attr('content')?.trim() ||
    $('time[datetime]').first().attr('datetime')?.trim() ||
    null;

  const site_name =
    $('meta[property="og:site_name"]').attr('content')?.trim() ||
    safeUrl.hostname.replace(/^www\./, '');

  // Extract main article paragraphs prioritizing semantic containers
  let paragraphs: string[] = [];
  const articleContainer = $('article, [role="main"], main, .article-body, .story-body, .post-content').first();
  const rootSel = articleContainer.length > 0 ? articleContainer : $('body');

  rootSel.find('p').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length >= 40) {
      paragraphs.push(text);
    }
  });

  if (paragraphs.length === 0) {
    $('p').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length >= 35) paragraphs.push(text);
    });
  }

  const body = paragraphs.join('\n\n').trim();
  const wordCount = body ? body.split(/\s+/).length : 0;

  // Detect common paywall or JS-blocker stubs
  const lowerBody = body.toLowerCase();
  if (
    wordCount < 25 ||
    lowerBody.includes('enable javascript and cookies to continue') ||
    lowerBody.includes('subscribe to read the full article')
  ) {
    throw new Error(
      'Article body could not be cleanly extracted (possible paywall, JavaScript-rendered wall, or minimal text). Use Full Article mode to paste the text directly.'
    );
  }

  return {
    url: response.url || safeUrl.toString(),
    domain: safeUrl.hostname.replace(/^www\./, ''),
    title: title || 'Extracted Article',
    body: body.slice(0, 15000),
    author: author || null,
    published_date: published_date || null,
    site_name: site_name || null,
    word_count: wordCount,
  };
}

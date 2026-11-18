import { GoogleGenAI, Type } from '@google/genai';

export interface VerificationReference {
  claim_text: string;
  source_name: string;
  source_url: string;
  finding: string;
  stance: 'supporting' | 'contradicting' | 'context';
  publication_date: string | null;
}

export interface FactCheckResult {
  available: boolean;
  reason: string | null;
  extracted_claims: string[];
  references: VerificationReference[];
}

export async function verifyClaimsIndependently(
  headline: string | null,
  articleText: string
): Promise<FactCheckResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim().length < 10) {
    return {
      available: false,
      reason:
        'Independent evidence search is not configured (GEMINI_API_KEY missing). Machine learning linguistic analysis remains fully active.',
      extracted_claims: [],
      references: [],
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const excerpt = `${headline ? `Headline: ${headline}\n` : ''}Article: ${articleText.slice(0, 2200)}`;

    // Step 1: Extract factual claims using structured JSON schema
    const claimsResp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Extract 1 to 3 concrete, checkable factual claims from the following news text. Do not invent claims not present in the text.\n\n${excerpt}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            claims: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['claims'],
        },
      },
    });

    let claims: string[] = [];
    try {
      const parsed = JSON.parse((claimsResp.text || '{}').trim());
      if (Array.isArray(parsed.claims)) {
        claims = parsed.claims.map(String).slice(0, 3);
      }
    } catch {
      claims = [];
    }

    if (claims.length === 0) {
      return {
        available: false,
        reason: 'No specific verifiable factual claims could be extracted from the submitted text.',
        extracted_claims: [],
        references: [],
      };
    }

    // Step 2: Search independent public reporting using Google Search grounding
    const searchResp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Search independent news and fact-checking sources for the following claims. Summarize objectively whether grounded web sources support, contradict, or provide context for each claim. Never invent citations.\n\nClaims:\n${claims.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const groundingChunks =
      searchResp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const webSources = groundingChunks
      .filter((c) => c.web?.uri && c.web?.title)
      .map((c) => ({
        title: c.web!.title!,
        uri: c.web!.uri!,
      }));

    if (webSources.length === 0) {
      return {
        available: false,
        reason:
          'Independent verification was unavailable: no matching external fact-checking or corroborating news references were returned by web search.',
        extracted_claims: claims,
        references: [],
      };
    }

    const summaryText = (searchResp.text || '').trim();
    const lowerSummary = summaryText.toLowerCase();
    const inferredStance: 'supporting' | 'contradicting' | 'context' =
      lowerSummary.includes('false') ||
      lowerSummary.includes('contradict') ||
      lowerSummary.includes('no evidence') ||
      lowerSummary.includes('debunk')
        ? 'contradicting'
        : lowerSummary.includes('confirm') || lowerSummary.includes('corroborat') || lowerSummary.includes('support')
          ? 'supporting'
          : 'context';

    const references: VerificationReference[] = webSources.slice(0, 5).map((src, idx) => {
      let host = src.title;
      try {
        host = new URL(src.uri).hostname.replace(/^www\./, '');
      } catch {
        // ignore
      }
      return {
        claim_text: claims[idx % claims.length],
        source_name: src.title || host,
        source_url: src.uri,
        finding:
          idx === 0 && summaryText
            ? summaryText.slice(0, 340) + (summaryText.length > 340 ? '...' : '')
            : `Grounded web reference retrieved for claim review via ${host}.`,
        stance: inferredStance,
        publication_date: null,
      };
    });

    return {
      available: true,
      reason: null,
      extracted_claims: claims,
      references,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Verification error';
    return {
      available: false,
      reason: `Independent verification unavailable (${msg}).`,
      extracted_claims: [],
      references: [],
    };
  }
}

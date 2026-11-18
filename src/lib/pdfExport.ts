import { jsPDF } from 'jspdf';
import { formatProbabilityPct, formatThresholdPct } from './probability';
import { AnalysisResponse } from '../types';

export function generateAnalysisPdfReport(analysis: AnalysisResponse) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const maxWidth = pageWidth - margin * 2;
  let y = 48;

  const checkPageBreak = (needed = 60) => {
    if (y + needed > pageHeight - 48) {
      doc.addPage();
      y = 48;
    }
  };

  // Header Banner
  doc.setFillColor(16, 21, 34);
  doc.rect(0, 0, pageWidth, 82, 'F');
  doc.setTextColor(40, 223, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('TRUTHLENS AI', margin, 36);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('See Beyond The Headline — News Verification & Explainable NLP Report', margin, 54);
  doc.text(`Report ID: ${analysis.id.slice(0, 12)}  |  ${new Date(analysis.created_at).toUTCString()}`, margin, 68);

  y = 108;

  // Classification Summary Box
  const pred = analysis.ml_result.prediction;
  const badgeColor: [number, number, number] =
    pred === 'REAL' ? [101, 163, 13] : pred === 'FAKE' ? [225, 29, 72] : [124, 58, 237];

  doc.setDrawColor(210, 218, 230);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, maxWidth, 74, 4, 4, 'FD');

  doc.setTextColor(...badgeColor);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`CLASSIFICATION: ${pred}`, margin + 16, y + 28);

  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.text(
    `Calibrated Confidence: ${formatProbabilityPct(analysis.ml_result.confidence, analysis.ml_result.uncertainty_threshold)}   |   P(Fake): ${formatProbabilityPct(analysis.ml_result.prob_fake, analysis.ml_result.uncertainty_threshold)}   |   P(Real): ${formatProbabilityPct(analysis.ml_result.prob_real, analysis.ml_result.uncertainty_threshold)}`,
    margin + 16,
    y + 46
  );
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Model: ${analysis.ml_result.model_name} (${analysis.ml_result.model_version})   |   Threshold: ${formatThresholdPct(analysis.ml_result.uncertainty_threshold)}`,
    margin + 16,
    y + 62
  );

  y += 96;

  // Submitted Content
  const addSectionTitle = (title: string) => {
    checkPageBreak(44);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(15, 23, 42);
    doc.text(title, margin, y);
    y += 6;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageWidth - margin, y);
    y += 16;
  };

  const addParagraph = (text: string, fontSize = 10, color: [number, number, number] = [51, 65, 85]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      checkPageBreak(18);
      doc.text(line, margin, y);
      y += 14;
    }
    y += 6;
  };

  addSectionTitle('1. Submitted Content');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(analysis.headline || 'Untitled Submission', maxWidth);
  for (const line of titleLines) {
    checkPageBreak(18);
    doc.text(line, margin, y);
    y += 15;
  }
  y += 4;
  if (analysis.source_url) {
    addParagraph(`Source URL: ${analysis.source_url}`, 9.5, [37, 99, 235]);
  }
  const excerpt =
    analysis.article_text.length > 1400
      ? `${analysis.article_text.slice(0, 1400)}... [truncated for report brevity]`
      : analysis.article_text;
  addParagraph(excerpt, 9.5);

  // Explainable AI Summary
  addSectionTitle('2. Explainable AI Attribution');
  addParagraph(analysis.ml_result.explanation_summary, 10);

  if (analysis.ml_result.top_fake_features.length > 0) {
    const terms = analysis.ml_result.top_fake_features
      .slice(0, 6)
      .map((f) => `${f.term} (+${f.contribution.toFixed(3)})`)
      .join(', ');
    addParagraph(`Top FAKE-correlated signals: ${terms}`, 9.5, [190, 18, 60]);
  }
  if (analysis.ml_result.top_real_features.length > 0) {
    const terms = analysis.ml_result.top_real_features
      .slice(0, 6)
      .map((f) => `${f.term} (${f.contribution.toFixed(3)})`)
      .join(', ');
    addParagraph(`Top REAL-correlated signals: ${terms}`, 9.5, [4, 120, 87]);
  }

  // Source Credibility
  addSectionTitle('3. Source Credibility Assessment');
  if (analysis.source_credibility) {
    const sc = analysis.source_credibility;
    addParagraph(
      `Domain: ${sc.domain || 'None provided'}  |  Publisher: ${sc.publisher_name || 'Unknown'}  |  Profile: ${sc.known_profile.status.replace(/_/g, ' ')}`,
      9.5
    );
    addParagraph(sc.known_profile.summary, 9.5);
    if (sc.transparency_signals.length > 0) {
      addParagraph(`Transparency Signals: ${sc.transparency_signals.join('; ')}`, 9.5);
    }
  } else {
    addParagraph('No source URL metadata available for this submission.', 9.5);
  }

  // Independent Verification References
  addSectionTitle('4. Independent Verification References');
  const refs = analysis.fact_check?.references || analysis.verification_sources || [];
  if (refs.length > 0) {
    for (const ref of refs) {
      addParagraph(`[${ref.stance.toUpperCase()}] ${ref.source_name}: ${ref.finding} (${ref.source_url})`, 9);
    }
  } else {
    addParagraph(
      analysis.fact_check?.reason ||
        'Independent verification was unavailable or no external fact-check references were retrieved.',
      9.5
    );
  }

  // Limitations & Disclaimer
  addSectionTitle('5. Methodology Limitations & Disclaimer');
  for (const lim of analysis.ml_result.limitations) {
    addParagraph(`• ${lim}`, 9, [71, 85, 105]);
  }
  addParagraph(
    'IMPORTANT DISCLAIMER: Machine learning classification estimates linguistic similarity to labeled training datasets. A prediction or confidence score does NOT prove that a news article is factually true or false. Always consult primary evidence and independent journalism.',
    9,
    [15, 23, 42]
  );

  const safeSlug = (analysis.headline || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 32);
  doc.save(`truthlens-report-${safeSlug}.pdf`);
}

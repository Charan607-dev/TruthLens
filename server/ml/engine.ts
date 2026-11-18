import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

export type AlgorithmId = 'tfidf_logreg' | 'tfidf_nb' | 'tfidf_svm';

export interface ColumnMapping {
  titleCol?: string | null;
  textCol: string;
  labelCol: string;
  subjectCol?: string | null;
  dateCol?: string | null;
}

export interface DatasetValidationResult {
  headers: string[];
  detectedMapping: ColumnMapping;
  totalRows: number;
  validRows: number;
  fakeCount: number;
  realCount: number;
  duplicatesRemoved: number;
  missingRemoved: number;
  invalidLabelRows: number;
  sampleRows: Array<{ title: string; text: string; label: 'FAKE' | 'REAL' }>;
  records: Array<{ title: string; text: string; label: 0 | 1 }>; // 1 = FAKE, 0 = REAL
  warnings: string[];
}

export interface PreprocessConfig {
  removeStopwords: boolean;
  useBigrams: boolean;
  maxFeatures: number;
  minDf: number;
}

export interface ClassMetrics {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface EvaluationMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1_score: number;
  roc_auc: number;
  brier_score: number;
  per_class: {
    real: ClassMetrics;
    fake: ClassMetrics;
  };
  confusion_matrix: [[number, number], [number, number]]; // [[TN(real->real), FP(real->fake)], [FN(fake->real), TP(fake->fake)]]
  cv_accuracy_mean: number;
  cv_f1_mean: number;
  train_size: number;
  test_size: number;
}

export interface TrainedModelArtifact {
  id: string;
  model_name: string;
  algorithm: AlgorithmId;
  version: string;
  dataset_id: string;
  dataset_name: string;
  dataset_size: number;
  trained_at: string;
  preprocess: PreprocessConfig;
  vocabulary: Record<string, number>; // term -> index
  idf: number[];
  // Logistic Regression / Linear SVM weights
  weights?: number[];
  bias?: number;
  // Platt scaling calibration (for SVM margins -> probabilities)
  plattA?: number;
  plattB?: number;
  // Multinomial Naive Bayes parameters
  nbLogPriorFake?: number;
  nbLogPriorReal?: number;
  nbLogLikelihoodFake?: number[];
  nbLogLikelihoodReal?: number[];
  metrics: EvaluationMetrics;
}

export interface FeatureContribution {
  term: string;
  weight: number;
  tfidf: number;
  contribution: number; // > 0 pushes toward FAKE, < 0 pushes toward REAL
  direction: 'fake' | 'real';
}

export interface PredictionResult {
  prediction: 'REAL' | 'FAKE' | 'UNCERTAIN';
  raw_label: 'REAL' | 'FAKE';
  confidence: number; // 0..1 calibrated confidence in the winning class
  prob_fake: number;
  prob_real: number;
  uncertainty_threshold: number;
  model_name: string;
  model_version: string;
  algorithm: AlgorithmId;
  matched_features_count: number;
  total_tokens: number;
  vocabulary_coverage: number;
  top_fake_features: FeatureContribution[];
  top_real_features: FeatureContribution[];
  all_matched_terms: Array<{ term: string; direction: 'fake' | 'real'; contribution: number }>;
  explanation_summary: string;
  limitations: string[];
}

const ENGLISH_STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves',
]);

export function preprocessText(
  raw: string,
  config: Pick<PreprocessConfig, 'removeStopwords' | 'useBigrams'>
): string[] {
  if (!raw) return [];
  // Strip HTML tags, URLs, emails, and normalize punctuation/whitespace
  let clean = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return [];

  // Preserve meaningful 4-digit years (e.g. 1969, 1989) and alphanumeric science/tech tokens (h2o, co2, w3c, 5g)
  // while filtering out isolated short pure digits (1-3 digits) that carry little lexical specificity.
  let unigrams = clean
    .split(' ')
    .filter((t) => t.length >= 2 && (!/^\d+$/.test(t) || /^\d{4}$/.test(t)));
  if (config.removeStopwords) {
    unigrams = unigrams.filter((t) => !ENGLISH_STOPWORDS.has(t));
  }

  if (!config.useBigrams || unigrams.length < 2) {
    return unigrams;
  }

  const tokens = [...unigrams];
  for (let i = 0; i < unigrams.length - 1; i++) {
    tokens.push(`${unigrams[i]} ${unigrams[i + 1]}`);
  }
  return tokens;
}

export function normalizeLabel(raw: unknown): 0 | 1 | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // Binary 0/1 conventions (WELFake uses 0=fake, 1=real OR 1=fake, 0=real? Wait: let's support standard text labels and explicit 0/1)
  // In standard ISOT/binary datasets: fake / false / 1 (when label=fake) vs real / true / 0
  // Note: WELFake actually uses 0 = fake, 1 = real in Kaggle, whereas many datasets use 1 = fake, 0 = real.
  // We map standard explicit strings unambiguously and default 1=FAKE, 0=REAL (with UI warning for numeric labels).
  if (['fake', 'false', 'pants-fire', 'barely-true', 'misleading', 'hoax', 'unreliable'].includes(s)) {
    return 1;
  }
  if (['real', 'true', 'mostly-true', 'reliable', 'verified', 'legitimate'].includes(s)) {
    return 0;
  }
  if (s === '1') return 1;
  if (s === '0') return 0;
  return null;
}

export function detectColumns(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const findCol = (candidates: string[]): string | null => {
    for (const c of candidates) {
      const idx = lower.indexOf(c);
      if (idx !== -1) return headers[idx];
    }
    return null;
  };

  const titleCol = findCol(['title', 'headline', 'header']);
  const textCol = findCol(['text', 'article', 'body', 'content', 'statement']) || titleCol || headers[0];
  const labelCol = findCol(['label', 'class', 'target', 'verdict', 'is_fake', 'category']) || headers[headers.length - 1];
  const subjectCol = findCol(['subject', 'topic', 'section']);
  const dateCol = findCol(['date', 'published_at', 'timestamp']);

  return { titleCol, textCol, labelCol, subjectCol, dateCol };
}

export function validateAndParseCsv(
  csvBuffer: Buffer | string,
  overrideMapping?: Partial<ColumnMapping>,
  numericFakeValue: '1' | '0' = '1'
): DatasetValidationResult {
  const content = typeof csvBuffer === 'string' ? csvBuffer : csvBuffer.toString('utf8');
  const rawRows: Record<string, string>[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  if (rawRows.length === 0) {
    throw new Error('Uploaded CSV contains no data rows.');
  }

  const headers = Object.keys(rawRows[0]);
  const autoMapping = detectColumns(headers);
  const mapping: ColumnMapping = {
    titleCol: overrideMapping?.titleCol !== undefined ? overrideMapping.titleCol : autoMapping.titleCol,
    textCol: overrideMapping?.textCol || autoMapping.textCol,
    labelCol: overrideMapping?.labelCol || autoMapping.labelCol,
    subjectCol: overrideMapping?.subjectCol !== undefined ? overrideMapping.subjectCol : autoMapping.subjectCol,
    dateCol: overrideMapping?.dateCol !== undefined ? overrideMapping.dateCol : autoMapping.dateCol,
  };

  if (!headers.includes(mapping.textCol)) {
    throw new Error(`Mapped text column "${mapping.textCol}" not found in CSV headers.`);
  }
  if (!headers.includes(mapping.labelCol)) {
    throw new Error(`Mapped label column "${mapping.labelCol}" not found in CSV headers.`);
  }

  const seenNormalized = new Set<string>();
  const records: Array<{ title: string; text: string; label: 0 | 1 }> = [];
  let missingRemoved = 0;
  let duplicatesRemoved = 0;
  let invalidLabelRows = 0;
  let fakeCount = 0;
  let realCount = 0;
  let sawNumericLabels = false;

  for (const row of rawRows) {
    const titleVal = mapping.titleCol && row[mapping.titleCol] ? String(row[mapping.titleCol]).trim() : '';
    const textVal = row[mapping.textCol] ? String(row[mapping.textCol]).trim() : '';
    const rawLabel = row[mapping.labelCol];

    const combinedText = titleVal && textVal && titleVal !== textVal ? `${titleVal}. ${textVal}` : textVal || titleVal;
    if (!combinedText || combinedText.length < 15) {
      missingRemoved++;
      continue;
    }

    const labelStr = String(rawLabel ?? '').trim();
    let label: 0 | 1 | null = null;
    if (labelStr === '0' || labelStr === '1') {
      sawNumericLabels = true;
      label = labelStr === numericFakeValue ? 1 : 0;
    } else {
      label = normalizeLabel(rawLabel);
    }

    if (label === null) {
      invalidLabelRows++;
      continue;
    }

    const dedupeKey = combinedText.toLowerCase().replace(/\s+/g, ' ').slice(0, 400);
    if (seenNormalized.has(dedupeKey)) {
      duplicatesRemoved++;
      continue;
    }
    seenNormalized.add(dedupeKey);

    records.push({
      title: titleVal || combinedText.slice(0, 90),
      text: combinedText,
      label,
    });
    if (label === 1) fakeCount++;
    else realCount++;
  }

  const warnings: string[] = [];
  if (sawNumericLabels) {
    warnings.push(
      `Numeric labels (0/1) detected and mapped using ${numericFakeValue}=FAKE, ${numericFakeValue === '1' ? '0' : '1'}=REAL.`
    );
  }
  if (invalidLabelRows > 0) {
    warnings.push(`${invalidLabelRows} row(s) skipped due to unrecognized label values.`);
  }
  if (records.length < 20) {
    throw new Error(
      `Insufficient valid rows after cleaning (${records.length}). At least 20 labeled records are required for stratified splitting.`
    );
  }
  if (fakeCount < 5 || realCount < 5) {
    throw new Error(
      `Dataset is severely imbalanced or single-class (FAKE: ${fakeCount}, REAL: ${realCount}). Both classes need at least 5 records.`
    );
  }

  return {
    headers,
    detectedMapping: mapping,
    totalRows: rawRows.length,
    validRows: records.length,
    fakeCount,
    realCount,
    duplicatesRemoved,
    missingRemoved,
    invalidLabelRows,
    sampleRows: records.slice(0, 5).map((r) => ({
      title: r.title,
      text: r.text.slice(0, 180) + (r.text.length > 180 ? '...' : ''),
      label: r.label === 1 ? 'FAKE' : 'REAL',
    })),
    records,
    warnings,
  };
}

// Deterministic seeded PRNG for reproducible train/test splitting
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const copy = [...arr];
  const rand = mulberry32(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function stratifiedSplit<T extends { label: 0 | 1 }>(
  records: T[],
  testRatio = 0.2,
  seed = 42
): { train: T[]; test: T[] } {
  const fakes = shuffleWithSeed(records.filter((r) => r.label === 1), seed);
  const reals = shuffleWithSeed(records.filter((r) => r.label === 0), seed + 1);

  const fakeTestCount = Math.max(1, Math.round(fakes.length * testRatio));
  const realTestCount = Math.max(1, Math.round(reals.length * testRatio));

  const test = shuffleWithSeed(
    [...fakes.slice(0, fakeTestCount), ...reals.slice(0, realTestCount)],
    seed + 2
  );
  const train = shuffleWithSeed(
    [...fakes.slice(fakeTestCount), ...reals.slice(realTestCount)],
    seed + 3
  );
  return { train, test };
}

type SparseVector = Array<[number, number]>; // [featureIndex, tfidfValue]

function fitTfidf(
  docs: string[][],
  maxFeatures: number,
  minDf: number
): { vocabulary: Record<string, number>; idf: number[]; vectors: SparseVector[] } {
  const dfMap = new Map<string, number>();
  for (const tokens of docs) {
    const seen = new Set(tokens);
    for (const tok of seen) {
      dfMap.set(tok, (dfMap.get(tok) || 0) + 1);
    }
  }

  // Filter by minDf and keep top maxFeatures by document frequency (within reasonable bounds)
  const candidates = Array.from(dfMap.entries())
    .filter(([, df]) => df >= minDf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxFeatures);

  const vocabulary: Record<string, number> = {};
  const idf: number[] = [];
  const nDocs = docs.length;

  candidates.forEach(([term, df], idx) => {
    vocabulary[term] = idx;
    // Smooth IDF: log((1 + N) / (1 + df)) + 1
    idf[idx] = Math.log((1 + nDocs) / (1 + df)) + 1;
  });

  const vectors = transformTfidf(docs, vocabulary, idf);
  return { vocabulary, idf, vectors };
}

function transformTfidf(
  docs: string[][],
  vocabulary: Record<string, number>,
  idf: number[]
): SparseVector[] {
  return docs.map((tokens) => {
    const tfCounts = new Map<number, number>();
    for (const tok of tokens) {
      const idx = vocabulary[tok];
      if (idx !== undefined) {
        tfCounts.set(idx, (tfCounts.get(idx) || 0) + 1);
      }
    }

    const vec: SparseVector = [];
    let normSq = 0;
    for (const [idx, count] of tfCounts.entries()) {
      // Sublinear TF scaling * IDF
      const val = (1 + Math.log(count)) * idf[idx];
      vec.push([idx, val]);
      normSq += val * val;
    }
    const norm = Math.sqrt(normSq);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i][1] /= norm;
      }
    }
    vec.sort((a, b) => a[0] - b[0]);
    return vec;
  });
}

function sigmoid(z: number): number {
  if (z > 30) return 1 - 1e-13;
  if (z < -30) return 1e-13;
  return 1 / (1 + Math.exp(-z));
}

function dotSparse(vec: SparseVector, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i][1] * weights[vec[i][0]];
  }
  return sum;
}

// Train L2-regularized Logistic Regression with Nesterov/momentum batch gradient descent
function trainLogisticRegression(
  vectors: SparseVector[],
  labels: Array<0 | 1>,
  numFeatures: number,
  C = 6.0,
  epochs = 320
): { weights: number[]; bias: number } {
  const weights = new Array<number>(numFeatures).fill(0);
  const velW = new Array<number>(numFeatures).fill(0);
  let bias = 0;
  let velB = 0;
  const n = Math.max(1, vectors.length);
  const reg = 1 / (C * n);
  const lr = 6.0;
  const momentum = 0.85;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array<number>(numFeatures).fill(0);
    let gradB = 0;

    for (let idx = 0; idx < n; idx++) {
      const x = vectors[idx];
      const y = labels[idx];
      const z = dotSparse(x, weights) + bias;
      const p = sigmoid(z);
      const err = p - y;
      gradB += err;
      for (let k = 0; k < x.length; k++) {
        gradW[x[k][0]] += err * x[k][1];
      }
    }

    const stepLr = lr / (1 + 0.005 * epoch);
    for (let j = 0; j < numFeatures; j++) {
      const g = gradW[j] / n + reg * weights[j];
      velW[j] = momentum * velW[j] - stepLr * g;
      weights[j] += velW[j];
    }
    velB = momentum * velB - stepLr * (gradB / n);
    bias += velB;
  }

  return { weights, bias };
}

// Train Multinomial Naive Bayes with Laplace smoothing alpha = 1.0
function trainMultinomialNB(
  vectors: SparseVector[],
  labels: Array<0 | 1>,
  numFeatures: number,
  alpha = 1.0
): {
  logPriorFake: number;
  logPriorReal: number;
  logLikelihoodFake: number[];
  logLikelihoodReal: number[];
} {
  let fakeDocs = 0;
  let realDocs = 0;
  const sumFake = new Array<number>(numFeatures).fill(0);
  const sumReal = new Array<number>(numFeatures).fill(0);
  let totalFake = 0;
  let totalReal = 0;

  for (let i = 0; i < vectors.length; i++) {
    const x = vectors[i];
    if (labels[i] === 1) {
      fakeDocs++;
      for (let k = 0; k < x.length; k++) {
        sumFake[x[k][0]] += x[k][1];
        totalFake += x[k][1];
      }
    } else {
      realDocs++;
      for (let k = 0; k < x.length; k++) {
        sumReal[x[k][0]] += x[k][1];
        totalReal += x[k][1];
      }
    }
  }

  const n = Math.max(1, fakeDocs + realDocs);
  const logPriorFake = Math.log((fakeDocs + 1e-6) / n);
  const logPriorReal = Math.log((realDocs + 1e-6) / n);
  const denomFake = totalFake + alpha * numFeatures;
  const denomReal = totalReal + alpha * numFeatures;

  const logLikelihoodFake = sumFake.map((c) => Math.log((c + alpha) / denomFake));
  const logLikelihoodReal = sumReal.map((c) => Math.log((c + alpha) / denomReal));

  return { logPriorFake, logPriorReal, logLikelihoodFake, logLikelihoodReal };
}

// Train Linear SVM using Hinge Loss + L2 Regularization + Platt Calibration
function trainLinearSVM(
  vectors: SparseVector[],
  labels: Array<0 | 1>,
  numFeatures: number,
  C = 1.5,
  epochs = 90
): { weights: number[]; bias: number; plattA: number; plattB: number } {
  const weights = new Array<number>(numFeatures).fill(0);
  let bias = 0;
  const n = vectors.length;
  const lambda = 1 / (C * Math.max(1, n));
  const indices = Array.from({ length: n }, (_, i) => i);

  for (let epoch = 0; epoch < epochs; epoch++) {
    const shuffled = shuffleWithSeed(indices, 500 + epoch);
    const lr = 0.5 / (1 + 0.06 * epoch);

    for (const idx of shuffled) {
      const x = vectors[idx];
      const ySigned = labels[idx] === 1 ? 1 : -1;
      const margin = ySigned * (dotSparse(x, weights) + bias);

      // Weight decay
      for (let j = 0; j < numFeatures; j++) {
        weights[j] *= 1 - lr * lambda;
      }

      if (margin < 1) {
        for (let k = 0; k < x.length; k++) {
          weights[x[k][0]] += lr * ySigned * x[k][1];
        }
        bias += lr * ySigned;
      }
    }
  }

  // Fit 1D logistic calibration (Platt scaling) on decision margins: P(y=1|m) = sigmoid(-(A*m + B))
  const margins = vectors.map((v) => dotSparse(v, weights) + bias);
  let plattA = -1.5;
  let plattB = 0;
  for (let iter = 0; iter < 150; iter++) {
    let gA = 0;
    let gB = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(-(plattA * margins[i] + plattB));
      const dLossDz = p - labels[i];
      gA += dLossDz * -margins[i];
      gB += dLossDz * -1;
    }
    plattA -= (0.5 / n) * gA;
    plattB -= (0.5 / n) * gB;
  }

  return { weights, bias, plattA, plattB };
}

function predictProbabilityFromArtifact(
  vec: SparseVector,
  artifact: Pick<
    TrainedModelArtifact,
    | 'algorithm'
    | 'weights'
    | 'bias'
    | 'plattA'
    | 'plattB'
    | 'nbLogPriorFake'
    | 'nbLogPriorReal'
    | 'nbLogLikelihoodFake'
    | 'nbLogLikelihoodReal'
  >
): number {
  if (artifact.algorithm === 'tfidf_logreg') {
    const z = dotSparse(vec, artifact.weights || []) + (artifact.bias || 0);
    return sigmoid(z);
  }
  if (artifact.algorithm === 'tfidf_svm') {
    const margin = dotSparse(vec, artifact.weights || []) + (artifact.bias || 0);
    const a = artifact.plattA ?? -1.5;
    const b = artifact.plattB ?? 0;
    return sigmoid(-(a * margin + b));
  }
  // Multinomial Naive Bayes posterior via log-sum-exp
  const llFake = artifact.nbLogLikelihoodFake || [];
  const llReal = artifact.nbLogLikelihoodReal || [];
  let logFake = artifact.nbLogPriorFake ?? Math.log(0.5);
  let logReal = artifact.nbLogPriorReal ?? Math.log(0.5);
  for (let k = 0; k < vec.length; k++) {
    const [idx, val] = vec[k];
    logFake += val * (llFake[idx] ?? 0);
    logReal += val * (llReal[idx] ?? 0);
  }
  const maxLog = Math.max(logFake, logReal);
  const expFake = Math.exp(logFake - maxLog);
  const expReal = Math.exp(logReal - maxLog);
  return expFake / (expFake + expReal);
}

function computeRocAuc(probs: number[], labels: Array<0 | 1>): number {
  const pairs = probs.map((p, i) => ({ p, y: labels[i] })).sort((a, b) => b.p - a.p);
  const totalPos = labels.filter((y) => y === 1).length;
  const totalNeg = labels.length - totalPos;
  if (totalPos === 0 || totalNeg === 0) return 0.5;

  let tp = 0;
  let fp = 0;
  let prevTpr = 0;
  let prevFpr = 0;
  let auc = 0;

  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].y === 1) tp++;
    else fp++;
    if (i === pairs.length - 1 || pairs[i].p !== pairs[i + 1].p) {
      const tpr = tp / totalPos;
      const fpr = fp / totalNeg;
      auc += ((fpr - prevFpr) * (tpr + prevTpr)) / 2;
      prevTpr = tpr;
      prevFpr = fpr;
    }
  }
  return Math.max(0, Math.min(1, auc));
}

function evaluatePredictions(probs: number[], labels: Array<0 | 1>) {
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let tp = 0;
  let brierSum = 0;

  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    const pred = p >= 0.5 ? 1 : 0;
    const actual = labels[i];
    brierSum += (p - actual) * (p - actual);
    if (actual === 0 && pred === 0) tn++;
    else if (actual === 0 && pred === 1) fp++;
    else if (actual === 1 && pred === 0) fn++;
    else tp++;
  }

  const accuracy = (tp + tn) / Math.max(1, probs.length);
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1_score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const realPrecision = tn / Math.max(1, tn + fn);
  const realRecall = tn / Math.max(1, tn + fp);
  const realF1 =
    realPrecision + realRecall > 0 ? (2 * realPrecision * realRecall) / (realPrecision + realRecall) : 0;

  const roc_auc = computeRocAuc(probs, labels);
  const brier_score = brierSum / Math.max(1, probs.length);

  return {
    accuracy,
    precision,
    recall,
    f1_score,
    roc_auc,
    brier_score,
    per_class: {
      real: { precision: realPrecision, recall: realRecall, f1: realF1, support: tn + fp },
      fake: { precision, recall, f1: f1_score, support: tp + fn },
    },
    confusion_matrix: [
      [tn, fp],
      [fn, tp],
    ] as [[number, number], [number, number]],
  };
}

function fitAndScoreSingleAlgorithm(
  algorithm: AlgorithmId,
  trainTokens: string[][],
  trainLabels: Array<0 | 1>,
  evalTokens: string[][],
  evalLabels: Array<0 | 1>,
  preprocess: PreprocessConfig
) {
  const { vocabulary, idf, vectors: trainVecs } = fitTfidf(
    trainTokens,
    preprocess.maxFeatures,
    preprocess.minDf
  );
  const evalVecs = transformTfidf(evalTokens, vocabulary, idf);
  const numFeatures = Object.keys(vocabulary).length;

  let partialArtifact: Partial<TrainedModelArtifact> = { algorithm };
  if (algorithm === 'tfidf_logreg') {
    const { weights, bias } = trainLogisticRegression(trainVecs, trainLabels, numFeatures);
    partialArtifact = { algorithm, weights, bias };
  } else if (algorithm === 'tfidf_nb') {
    const nb = trainMultinomialNB(trainVecs, trainLabels, numFeatures);
    partialArtifact = {
      algorithm,
      nbLogPriorFake: nb.logPriorFake,
      nbLogPriorReal: nb.logPriorReal,
      nbLogLikelihoodFake: nb.logLikelihoodFake,
      nbLogLikelihoodReal: nb.logLikelihoodReal,
    };
  } else {
    const svm = trainLinearSVM(trainVecs, trainLabels, numFeatures);
    partialArtifact = {
      algorithm,
      weights: svm.weights,
      bias: svm.bias,
      plattA: svm.plattA,
      plattB: svm.plattB,
    };
  }

  const probs = evalVecs.map((v) =>
    predictProbabilityFromArtifact(v, partialArtifact as TrainedModelArtifact)
  );
  const evalStats = evaluatePredictions(probs, evalLabels);

  return { vocabulary, idf, partialArtifact, evalStats };
}

export const ALGORITHM_DISPLAY_NAMES: Record<AlgorithmId, string> = {
  tfidf_logreg: 'TF-IDF + Logistic Regression',
  tfidf_nb: 'TF-IDF + Multinomial Naive Bayes',
  tfidf_svm: 'TF-IDF + Linear SVM',
};

export function trainModelPipeline(params: {
  modelId: string;
  version: string;
  algorithm: AlgorithmId;
  datasetId: string;
  datasetName: string;
  records: Array<{ title: string; text: string; label: 0 | 1 }>;
  testRatio?: number;
  cvFolds?: number;
  preprocess?: Partial<PreprocessConfig>;
  modelsDir: string;
}): { artifact: TrainedModelArtifact; artifactPath: string } {
  const preprocess: PreprocessConfig = {
    removeStopwords: params.preprocess?.removeStopwords ?? true,
    useBigrams: params.preprocess?.useBigrams ?? true,
    maxFeatures: params.preprocess?.maxFeatures ?? 6500,
    minDf: params.preprocess?.minDf ?? (params.records.length < 600 ? 1 : 2),
  };
  const testRatio = params.testRatio ?? 0.2;
  const cvFolds = params.cvFolds ?? 3;

  const { train, test } = stratifiedSplit(params.records, testRatio, 42);
  const trainTokens = train.map((r) => preprocessText(r.text, preprocess));
  const trainLabels = train.map((r) => r.label);
  const testTokens = test.map((r) => preprocessText(r.text, preprocess));
  const testLabels = test.map((r) => r.label);

  // K-Fold Stratified Cross-Validation on training set only (zero leakage)
  const fakeIdx = trainLabels
    .map((l, idx) => (l === 1 ? idx : -1))
    .filter((i) => i !== -1);
  const realIdx = trainLabels
    .map((l, idx) => (l === 0 ? idx : -1))
    .filter((i) => i !== -1);

  const cvAccs: number[] = [];
  const cvF1s: number[] = [];
  const k = Math.max(2, Math.min(cvFolds, Math.min(fakeIdx.length, realIdx.length)));

  for (let fold = 0; fold < k; fold++) {
    const valSet = new Set<number>();
    fakeIdx.forEach((idx, pos) => {
      if (pos % k === fold) valSet.add(idx);
    });
    realIdx.forEach((idx, pos) => {
      if (pos % k === fold) valSet.add(idx);
    });

    const foldTrainTok: string[][] = [];
    const foldTrainLbl: Array<0 | 1> = [];
    const foldValTok: string[][] = [];
    const foldValLbl: Array<0 | 1> = [];

    for (let i = 0; i < trainTokens.length; i++) {
      if (valSet.has(i)) {
        foldValTok.push(trainTokens[i]);
        foldValLbl.push(trainLabels[i]);
      } else {
        foldTrainTok.push(trainTokens[i]);
        foldTrainLbl.push(trainLabels[i]);
      }
    }

    if (foldValTok.length > 0 && foldTrainTok.length > 0) {
      const foldRes = fitAndScoreSingleAlgorithm(
        params.algorithm,
        foldTrainTok,
        foldTrainLbl,
        foldValTok,
        foldValLbl,
        preprocess
      );
      cvAccs.push(foldRes.evalStats.accuracy);
      cvF1s.push(foldRes.evalStats.f1_score);
    }
  }

  const cv_accuracy_mean =
    cvAccs.length > 0 ? cvAccs.reduce((a, b) => a + b, 0) / cvAccs.length : 0;
  const cv_f1_mean =
    cvF1s.length > 0 ? cvF1s.reduce((a, b) => a + b, 0) / cvF1s.length : 0;

  // Final fit on full training split & evaluate on held-out test split
  const finalFit = fitAndScoreSingleAlgorithm(
    params.algorithm,
    trainTokens,
    trainLabels,
    testTokens,
    testLabels,
    preprocess
  );

  const artifact: TrainedModelArtifact = {
    id: params.modelId,
    model_name: ALGORITHM_DISPLAY_NAMES[params.algorithm],
    algorithm: params.algorithm,
    version: params.version,
    dataset_id: params.datasetId,
    dataset_name: params.datasetName,
    dataset_size: params.records.length,
    trained_at: new Date().toISOString(),
    preprocess,
    vocabulary: finalFit.vocabulary,
    idf: finalFit.idf,
    ...finalFit.partialArtifact,
    metrics: {
      ...finalFit.evalStats,
      cv_accuracy_mean,
      cv_f1_mean,
      train_size: train.length,
      test_size: test.length,
    },
  };

  fs.mkdirSync(params.modelsDir, { recursive: true });
  const artifactPath = path.join(params.modelsDir, `${params.modelId}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8');

  return { artifact, artifactPath };
}

export function loadModelArtifact(artifactPath: string): TrainedModelArtifact {
  const modelsRoot = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR, 'models')
    : path.resolve(process.cwd(), 'data', 'models');
  const candidatePath = fs.existsSync(artifactPath)
    ? artifactPath
    : path.join(modelsRoot, path.basename(artifactPath));

  if (!fs.existsSync(candidatePath)) {
    throw new Error(`Model artifact file not found at ${artifactPath}`);
  }
  const raw = fs.readFileSync(candidatePath, 'utf8');
  return JSON.parse(raw) as TrainedModelArtifact;
}

export function predictWithExplanation(
  text: string,
  artifact: TrainedModelArtifact,
  uncertaintyThreshold = 0.62
): PredictionResult {
  const tokens = preprocessText(text, artifact.preprocess);
  const vectors = transformTfidf([tokens], artifact.vocabulary, artifact.idf);
  const vec = vectors[0];

  const invVocab: string[] = [];
  for (const [term, idx] of Object.entries(artifact.vocabulary)) {
    invVocab[idx] = term;
  }

  const matchedCount = vec.length;
  const probFake = predictProbabilityFromArtifact(vec, artifact);
  const probReal = 1 - probFake;
  const raw_label: 'REAL' | 'FAKE' = probFake >= 0.5 ? 'FAKE' : 'REAL';
  const winningConfidence = Math.max(probFake, probReal);

  const uniqueUnigrams = new Set(tokens.filter((t) => !t.includes(' '))).size;
  const matchedUnigrams = vec.filter(([idx]) => !invVocab[idx]?.includes(' ')).length;
  const vocabulary_coverage = uniqueUnigrams > 0 ? matchedUnigrams / uniqueUnigrams : 0;

  const isInsufficientTokens = matchedCount < 2 || tokens.length < 3;
  const prediction: 'REAL' | 'FAKE' | 'UNCERTAIN' =
    isInsufficientTokens || winningConfidence < uncertaintyThreshold ? 'UNCERTAIN' : raw_label;

  // Genuine feature-level attribution (no fabricated explanations)
  const contributions: FeatureContribution[] = [];
  for (const [idx, tfidfVal] of vec) {
    const term = invVocab[idx];
    let weight = 0;
    if (artifact.algorithm === 'tfidf_nb') {
      const llFake = artifact.nbLogLikelihoodFake?.[idx] ?? 0;
      const llReal = artifact.nbLogLikelihoodReal?.[idx] ?? 0;
      weight = llFake - llReal;
    } else {
      weight = artifact.weights?.[idx] ?? 0;
    }
    const contribution = tfidfVal * weight;
    if (Math.abs(contribution) > 1e-5) {
      contributions.push({
        term,
        weight,
        tfidf: tfidfVal,
        contribution,
        direction: contribution >= 0 ? 'fake' : 'real',
      });
    }
  }

  const top_fake_features = contributions
    .filter((c) => c.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 8);

  const top_real_features = contributions
    .filter((c) => c.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, 8);

  const all_matched_terms = contributions
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 24)
    .map((c) => ({ term: c.term, direction: c.direction, contribution: c.contribution }));

  let explanation_summary = '';
  if (isInsufficientTokens) {
    explanation_summary =
      `Only ${matchedCount} recognized vocabulary term(s) matched the active model (${(vocabulary_coverage * 100).toFixed(0)}% unigram coverage). Input length is insufficient for reliable statistical classification, so it is classified as UNCERTAIN.`;
  } else if (prediction === 'UNCERTAIN') {
    explanation_summary =
      `Model probability (${(winningConfidence * 100).toFixed(1)}%) falls below the configured ${(uncertaintyThreshold * 100).toFixed(0)}% confidence threshold across ${matchedCount} matched features (${(vocabulary_coverage * 100).toFixed(0)}% unigram coverage). Both misinformation-correlated and institutional-reporting signals were detected without a decisive margin.`;
  } else if (prediction === 'FAKE') {
    const terms = top_fake_features.slice(0, 4).map((f) => `"${f.term}"`).join(', ');
    explanation_summary =
      `The active ${artifact.model_name} classifier assigned a ${(probFake * 100).toFixed(1)}% statistical score toward the FAKE training class (${(vocabulary_coverage * 100).toFixed(0)}% unigram coverage), driven primarily by phrasing such as ${terms || 'misinformation-correlated patterns'} learned from the training dataset.`;
  } else {
    const terms = top_real_features.slice(0, 4).map((f) => `"${f.term}"`).join(', ');
    explanation_summary =
      `The active ${artifact.model_name} classifier assigned a ${(probReal * 100).toFixed(1)}% statistical score toward the REAL training class (${(vocabulary_coverage * 100).toFixed(0)}% unigram coverage), driven by reporting patterns such as ${terms || 'standard journalistic terms'} learned from the training dataset.`;
  }

  const limitations = [
    'Statistical NLP predictions reflect linguistic patterns observed in the training corpus and do NOT constitute proof of factual truth or falsehood.',
    'Short headlines contain fewer TF-IDF features than full-length articles, which can lower model confidence.',
    `Model trained on "${artifact.dataset_name}" (${artifact.dataset_size} cleaned records); domain shift outside this corpus may reduce accuracy.`,
  ];

  return {
    prediction,
    raw_label,
    confidence: winningConfidence,
    prob_fake: probFake,
    prob_real: probReal,
    uncertainty_threshold: uncertaintyThreshold,
    model_name: artifact.model_name,
    model_version: artifact.version,
    algorithm: artifact.algorithm,
    matched_features_count: matchedCount,
    total_tokens: tokens.length,
    vocabulary_coverage,
    top_fake_features,
    top_real_features,
    all_matched_terms,
    explanation_summary,
    limitations,
  };
}

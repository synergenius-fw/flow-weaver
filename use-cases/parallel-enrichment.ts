// =============================================================================
// Parallel Enrichment - Fan-out / fan-in pattern.
//
// Demonstrates:
//   - Parallel execution: 3 independent normal-mode nodes triggered from Start
//   - Expression merge node: combines parallel results without control flow boilerplate
//   - Explicit @connect wiring (required for fan-out, @path only supports linear chains)
//   - Mixed node types: normal-mode for side-effectful work, expression for pure transforms
//
// Pattern: Start -> [sentiment, readability, keywords] -> merge -> score -> Exit
//
// Run: flow-weaver run use-cases/parallel-enrichment.ts --params '{"text":"Great product, fast shipping! Highly recommend."}'
// =============================================================================

// -- Types --

interface AnalysisResult {
  source: string;
  score: number;
  details: Record<string, unknown>;
}

// -- Expression Node --

/**
 * Merges analysis results from all parallel analyzers into a unified report.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Merge Results
 * @input sentiment [order:1] - Sentiment analysis result
 * @input readability [order:2] - Readability analysis result
 * @input keywords [order:3] - Keyword analysis result
 * @output report [order:1] - Combined analysis report
 * @output analyzerCount [order:2] - Number of successful analyzers
 */
function mergeResults(
  sentiment: AnalysisResult,
  readability: AnalysisResult,
  keywords: AnalysisResult
): { report: Record<string, unknown>; analyzerCount: number } {
  const results = [sentiment, readability, keywords];
  const report: Record<string, unknown> = {};
  for (const r of results) {
    report[r.source] = { score: r.score, ...r.details };
  }
  return { report, analyzerCount: results.length };
}

// -- Normal-Mode Nodes --

/**
 * Analyzes text sentiment (positive, negative, neutral).
 *
 * @flowWeaver nodeType
 * @label Analyze Sentiment
 * @input text [order:1] - Text to analyze
 * @output result [order:2] - Sentiment analysis result
 */
function analyzeSentiment(
  execute: boolean,
  text: string
): { onSuccess: boolean; onFailure: boolean; result: AnalysisResult | null } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };

  const positiveWords = ['great', 'good', 'excellent', 'fast', 'love', 'amazing', 'recommend'];
  const negativeWords = ['bad', 'slow', 'terrible', 'hate', 'awful', 'poor', 'worst'];
  const words = text.toLowerCase().split(/\s+/);
  const pos = words.filter((w) => positiveWords.includes(w)).length;
  const neg = words.filter((w) => negativeWords.includes(w)).length;
  const score = (pos - neg) / Math.max(words.length, 1);

  return {
    onSuccess: true,
    onFailure: false,
    result: {
      source: 'sentiment',
      score: Math.round((score + 1) * 50),
      details: { positive: pos, negative: neg, neutral: words.length - pos - neg },
    },
  };
}

/**
 * Evaluates text readability using simple heuristics.
 *
 * @flowWeaver nodeType
 * @label Analyze Readability
 * @input text [order:1] - Text to analyze
 * @output result [order:2] - Readability analysis result
 */
function analyzeReadability(
  execute: boolean,
  text: string
): { onSuccess: boolean; onFailure: boolean; result: AnalysisResult | null } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/);
  const avgWordsPerSentence = words.length / Math.max(sentences.length, 1);
  const score = Math.max(0, Math.min(100, 100 - (avgWordsPerSentence - 15) * 5));

  return {
    onSuccess: true,
    onFailure: false,
    result: {
      source: 'readability',
      score: Math.round(score),
      details: {
        sentences: sentences.length,
        words: words.length,
        avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
      },
    },
  };
}

/**
 * Extracts keywords from text using word frequency analysis.
 *
 * @flowWeaver nodeType
 * @label Extract Keywords
 * @input text [order:1] - Text to analyze
 * @output result [order:2] - Keyword extraction result
 */
function extractKeywords(
  execute: boolean,
  text: string
): { onSuccess: boolean; onFailure: boolean; result: AnalysisResult | null } {
  if (!execute) return { onSuccess: false, onFailure: false, result: null };

  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'and', 'or', 'but',
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'it', 'this', 'that',
  ]);
  const words = text.toLowerCase().split(/\s+/).filter((w) => !stopWords.has(w) && w.length > 2);
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const topKeywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  return {
    onSuccess: true,
    onFailure: false,
    result: {
      source: 'keywords',
      score: Math.min(topKeywords.length * 20, 100),
      details: { keywords: topKeywords, uniqueWords: Object.keys(freq).length },
    },
  };
}

/**
 * Generates a final content quality score from the merged analysis.
 *
 * @flowWeaver nodeType
 * @label Score Content
 * @input report [order:1] - Merged analysis report
 * @input analyzerCount [order:2] - Number of analyzers that contributed
 * @output score [order:2] - Overall content score 0-100
 * @output grade [order:3] - Content grade: A, B, C, D, F
 */
function scoreContent(
  execute: boolean,
  report: Record<string, unknown>,
  analyzerCount: number
): { onSuccess: boolean; onFailure: boolean; score: number; grade: string } {
  if (!execute) return { onSuccess: false, onFailure: false, score: 0, grade: '' };

  let totalScore = 0;
  let count = 0;
  for (const value of Object.values(report)) {
    if (value && typeof value === 'object' && 'score' in value) {
      totalScore += (value as { score: number }).score;
      count++;
    }
  }

  const avg = count > 0 ? totalScore / count : 0;
  const coverageBonus = analyzerCount >= 3 ? 5 : 0;
  const score = Math.min(100, Math.round(avg + coverageBonus));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  return { onSuccess: true, onFailure: false, score, grade };
}

// -- Workflow --

/**
 * @flowWeaver workflow
 * @node sent analyzeSentiment [position: -150 -150]
 * @node read analyzeReadability [position: -150 0]
 * @node kw extractKeywords [position: -150 150]
 * @node merge mergeResults [position: 100 0]
 * @node scorer scoreContent [position: 300 0]
 * @position Start -400 0
 * @position Exit 500 0
 * @connect Start.execute -> sent.execute
 * @connect Start.execute -> read.execute
 * @connect Start.execute -> kw.execute
 * @connect Start.text -> sent.text
 * @connect Start.text -> read.text
 * @connect Start.text -> kw.text
 * @connect sent.result -> merge.sentiment
 * @connect read.result -> merge.readability
 * @connect kw.result -> merge.keywords
 * @connect merge.report -> scorer.report
 * @connect merge.analyzerCount -> scorer.analyzerCount
 * @connect kw.onSuccess -> merge.execute
 * @connect merge.onSuccess -> scorer.execute
 * @connect scorer.onSuccess -> Exit.onSuccess
 * @connect scorer.score -> Exit.score
 * @connect scorer.grade -> Exit.grade
 * @connect merge.report -> Exit.report
 * @param execute [order:0] - Execute
 * @param text [order:1] - Text content to analyze
 * @returns onSuccess [order:0] - Analysis complete
 * @returns onFailure [order:1] - Analysis failed
 * @returns score [order:2] - Overall content score 0-100
 * @returns grade [order:3] - Content grade: A, B, C, D, F
 * @returns report [order:4] - Full analysis report
 */
export function contentAnalysis(
  execute: boolean,
  params: { text: string }
): {
  onSuccess: boolean;
  onFailure: boolean;
  score: number;
  grade: string;
  report: Record<string, unknown>;
} {
  throw new Error('Compile with: flow-weaver compile <file>');
}

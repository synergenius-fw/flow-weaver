
/**
 * Lead Processing Pipeline
 *
 * A realistic workflow that demonstrates what would be complex in n8n:
 * - Email validation with regex
 * - Data transformation
 * - Scoring algorithm
 * - Conditional categorization
 * - Error handling
 *
 * In n8n, this would require multiple Code nodes with sandboxed JS,
 * confusing expressions syntax, and no type safety.
 */

// ============================================================================
// TYPE DEFINITIONS (Flow Weaver advantage: real TypeScript types!)
// ============================================================================

interface RawLead {
  name: string;
  email: string;
  company: string;
  budget: number;
  source?: string;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  lead: RawLead;
}

interface EnrichedLead extends RawLead {
  timestamp: string;
  normalizedName: string;
  normalizedCompany: string;
  domain: string;
}

interface ScoredLead extends EnrichedLead {
  score: number;
  scoreBreakdown: {
    budgetScore: number;
    companyScore: number;
    sourceScore: number;
  };
}

interface ProcessedLead extends ScoredLead {
  category: 'high' | 'medium' | 'low';
  priority: number;
  followUpDate: string;
}

// ============================================================================
// NODE TYPES
// ============================================================================

/**
 * Validates incoming lead data
- Checks required fields
- Validates email format with regex
- Returns validation errors if any
 *
 * @flowWeaver nodeType
 * @label Validate Lead
 * @input lead [order:1] - Raw lead data to validate
 * @input execute [order:0] - Execute
 * @output validationResult [order:2] - Validation result with errors
 * @output isValid [order:3] - Whether the lead passed validation
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function validateLead(
  execute: boolean,
  lead: RawLead
): {
  onSuccess: boolean;
  onFailure: boolean;
  validationResult: ValidationResult;
  isValid: boolean;
} {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      validationResult: { isValid: false, errors: [], lead: {} as RawLead },
      isValid: false
    };
  }

  const errors: string[] = [];

  // Required field validation
  if (!lead.name || lead.name.trim() === '') {
    errors.push('Name is required');
  }

  if (!lead.email || lead.email.trim() === '') {
    errors.push('Email is required');
  } else {
    // Email format validation with regex (would be painful in n8n expressions!)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lead.email)) {
      errors.push('Invalid email format');
    }
  }

  if (!lead.company || lead.company.trim() === '') {
    errors.push('Company is required');
  }

  if (typeof lead.budget !== 'number' || lead.budget < 0) {
    errors.push('Budget must be a positive number');
  }

  const isValid = errors.length === 0;

  return {
    onSuccess: isValid,
    onFailure: !isValid,
    validationResult: { isValid, errors, lead },
    isValid
  };
}

/**
 * Enriches lead data with additional fields
- Adds timestamp
- Normalizes strings
- Extracts email domain
 *
 * @flowWeaver nodeType
 * @label Enrich Lead
 * @input lead [order:1] - Validated lead to enrich
 * @input execute [order:0] - Execute
 * @output enrichedLead [order:2] - Lead with additional data
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function enrichLead(
  execute: boolean,
  lead: RawLead
): {
  onSuccess: boolean;
  onFailure: boolean;
  enrichedLead: EnrichedLead;
} {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      enrichedLead: {} as EnrichedLead
    };
  }

  // Extract domain from email
  const domain = lead.email.split('@')[1] || '';

  // Normalize strings (title case for name, uppercase for company)
  const normalizedName = lead.name
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  const normalizedCompany = lead.company.trim().toUpperCase();

  const enrichedLead: EnrichedLead = {
    ...lead,
    timestamp: new Date().toISOString(),
    normalizedName,
    normalizedCompany,
    domain
  };

  return {
    onSuccess: true,
    onFailure: false,
    enrichedLead
  };
}

/**
 * Calculates lead score based on multiple factors
- Budget score (0-40 points)
- Company indicators (0-40 points)
- Source quality (0-20 points)
 *
 * @flowWeaver nodeType
 * @label Score Lead
 * @input lead [order:1] - Enriched lead to score
 * @input execute [order:0] - Execute
 * @output scoredLead [order:2] - Lead with score and breakdown
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function scoreLead(
  execute: boolean,
  lead: EnrichedLead
): {
  onSuccess: boolean;
  onFailure: boolean;
  scoredLead: ScoredLead;
} {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      scoredLead: {} as ScoredLead
    };
  }

  // Budget scoring (0-40 points)
  let budgetScore = 0;
  if (lead.budget >= 100000) budgetScore = 40;
  else if (lead.budget >= 50000) budgetScore = 30;
  else if (lead.budget >= 25000) budgetScore = 20;
  else if (lead.budget >= 10000) budgetScore = 10;
  else budgetScore = 5;

  // Company scoring based on domain indicators (0-40 points)
  let companyScore = 0;
  const enterpriseDomains = ['.enterprise', '.corp', '.inc'];
  const premiumIndicators = ['enterprise', 'global', 'international', 'group'];

  // Check for enterprise-ish domain
  if (enterpriseDomains.some(d => lead.domain.includes(d))) {
    companyScore += 20;
  }

  // Check for premium company name indicators
  if (premiumIndicators.some(ind => lead.normalizedCompany.toLowerCase().includes(ind))) {
    companyScore += 20;
  } else if (lead.normalizedCompany.length > 10) {
    companyScore += 10; // Longer names often indicate established companies
  }

  // Source scoring (0-20 points)
  let sourceScore = 0;
  const sourceScores: Record<string, number> = {
    'referral': 20,
    'enterprise-contact': 20,
    'demo-request': 15,
    'webinar': 10,
    'website': 5,
    'cold-outreach': 2
  };
  sourceScore = sourceScores[lead.source || ''] || 5;

  const score = budgetScore + companyScore + sourceScore;

  const scoredLead: ScoredLead = {
    ...lead,
    score,
    scoreBreakdown: {
      budgetScore,
      companyScore,
      sourceScore
    }
  };

  return {
    onSuccess: true,
    onFailure: false,
    scoredLead
  };
}

/**
 * Categorizes lead and sets priority based on score
- High: score >= 70 (priority 1, follow up in 1 day)
- Medium: score >= 40 (priority 2, follow up in 3 days)
- Low: score < 40 (priority 3, follow up in 7 days)
 *
 * @flowWeaver nodeType
 * @label Categorize Lead
 * @input lead [order:1] - Scored lead to categorize
 * @input execute [order:0] - Execute
 * @output processedLead [order:2] - Final processed lead with category
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function categorizeLead(
  execute: boolean,
  lead: ScoredLead
): {
  onSuccess: boolean;
  onFailure: boolean;
  processedLead: ProcessedLead;
} {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      processedLead: {} as ProcessedLead
    };
  }

  let category: 'high' | 'medium' | 'low';
  let priority: number;
  let followUpDays: number;

  if (lead.score >= 70) {
    category = 'high';
    priority = 1;
    followUpDays = 1;
  } else if (lead.score >= 40) {
    category = 'medium';
    priority = 2;
    followUpDays = 3;
  } else {
    category = 'low';
    priority = 3;
    followUpDays = 7;
  }

  // Calculate follow-up date
  const followUpDate = new Date();
  followUpDate.setDate(followUpDate.getDate() + followUpDays);

  const processedLead: ProcessedLead = {
    ...lead,
    category,
    priority,
    followUpDate: followUpDate.toISOString().split('T')[0]
  };

  return {
    onSuccess: true,
    onFailure: false,
    processedLead
  };
}

/**
 * Formats error response when validation fails
 *
 * @flowWeaver nodeType
 * @label Format Error
 * @input validationResult [order:1] - The validation result with errors
 * @input execute [order:0] - Execute
 * @output errorResponse [order:2] - Formatted error response
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function formatError(
  execute: boolean,
  validationResult: ValidationResult
): {
  onSuccess: boolean;
  onFailure: boolean;
  errorResponse: { success: false; errors: string[]; lead: RawLead };
} {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      errorResponse: { success: false, errors: [], lead: {} as RawLead }
    };
  }

  return {
    onSuccess: true,
    onFailure: false,
    errorResponse: {
      success: false,
      errors: validationResult.errors,
      lead: validationResult.lead
    }
  };
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * @flowWeaver workflow
 * @node validator validateLead
 * @node enricher enrichLead
 * @node scorer scoreLead
 * @node categorizer categorizeLead
 * @node errorFormatter formatError
 * @connect Start.lead -> validator.lead
 * @connect validator.onSuccess -> enricher.execute
 * @connect Start.lead -> enricher.lead
 * @connect enricher.enrichedLead -> scorer.lead
 * @connect enricher.onSuccess -> scorer.execute
 * @connect scorer.scoredLead -> categorizer.lead
 * @connect scorer.onSuccess -> categorizer.execute
 * @connect categorizer.processedLead -> Exit.processedLead
 * @connect categorizer.onSuccess -> Exit.onSuccess
 * @connect validator.onFailure -> errorFormatter.execute
 * @connect validator.validationResult -> errorFormatter.validationResult
 * @connect errorFormatter.errorResponse -> Exit.errorResponse
 * @param execute [order:0] - Execute
 * @param lead [order:1] - Lead
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns processedLead [order:2] - ProcessedLead
 * @returns errorResponse [order:3] - ErrorResponse
 */
export async function processLead(
  execute: boolean,
  params: { lead: RawLead }
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  processedLead?: ProcessedLead;
  errorResponse?: { success: false; errors: string[]; lead: RawLead };
}> {
  throw new Error('Not implemented');
}

// ============================================================================
// ADDITIONAL EXPORTS (demonstrating multiple workflows in one file)
// ============================================================================

/**
 * @flowWeaver nodeType
 * @input execute [order:0] - Execute
 * @input lead [order:1] - Lead
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output result [order:2] - Result
 * @output isValid [order:3] - IsValid
 */
export async function validateOnly(
  _execute: boolean,
  _params: { lead: RawLead }
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  result: ValidationResult;
  isValid: boolean;
}> {
  throw new Error('Not implemented - Flow Weaver will generate this');
}

/**
 * @flowWeaver nodeType
 * @input execute [order:0] - Execute
 * @input lead [order:1] - Lead
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output result [order:2] - Result
 */
export async function scoreAndCategorize(
  _execute: boolean,
  _params: { lead: EnrichedLead }
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  result: ProcessedLead;
}> {
  throw new Error('Not implemented - Flow Weaver will generate this');
}

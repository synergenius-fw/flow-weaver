// =============================================================================
// Data Pipeline - Linear pipeline with validation and error routing.
//
// Demonstrates:
//   - @path sugar for sequential control flow chains
//   - Normal-mode node (validateContact) with execute/onSuccess/onFailure branching
//   - @expression nodes (normalizeContact, formatRecord) mixed with normal nodes
//   - Error routing: validation failure short-circuits to Exit via onFailure
//
// Pattern: Start -> validate -> normalize -> format -> Exit
//          validate:fail --------------------------------> Exit
//
// Run: flow-weaver run use-cases/data-pipeline.ts --params '{"email":"jane@example.com","name":"jane doe"}'
// =============================================================================

// -- Normal-Mode Node (branching) --

/**
 * Validates a contact record before CRM import.
 * Routes to onFailure if email format is invalid or name is too short.
 *
 * @flowWeaver nodeType
 * @label Validate Contact
 * @input email [order:1] - Contact email address
 * @input name [order:2] - Contact full name
 * @output email [order:2] - Validated email (passed through on success)
 * @output name [order:3] - Validated name (passed through on success)
 * @output reason [order:4] - Rejection reason (populated on failure)
 */
function validateContact(
  execute: boolean,
  email: string,
  name: string
): { onSuccess: boolean; onFailure: boolean; email: string; name: string; reason: string } {
  if (!execute) return { onSuccess: false, onFailure: false, email: '', name: '', reason: '' };

  if (!email.includes('@')) {
    return { onSuccess: false, onFailure: true, email, name, reason: 'Invalid email: missing @' };
  }
  if (name.trim().length < 2) {
    return { onSuccess: false, onFailure: true, email, name, reason: 'Name too short (min 2 chars)' };
  }

  return { onSuccess: true, onFailure: false, email, name, reason: '' };
}

// -- Expression Nodes --

/**
 * Normalizes contact data: lowercases email, title-cases name.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Normalize Contact
 * @input email [order:1] - Raw email
 * @input name [order:2] - Raw name
 * @output email [order:1] - Normalized email
 * @output name [order:2] - Normalized name
 */
function normalizeContact(email: string, name: string): { email: string; name: string } {
  return {
    email: email.toLowerCase().trim(),
    name: name
      .trim()
      .split(/\s+/)
      .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join(' '),
  };
}

/**
 * Formats a contact as a JSON record ready for CRM import.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Format Record
 * @input email [order:1] - Normalized email
 * @input name [order:2] - Normalized name
 * @output record [order:1] - JSON-formatted CRM record
 */
function formatRecord(email: string, name: string): { record: string } {
  return { record: JSON.stringify({ email, name, importedAt: new Date().toISOString() }) };
}

// -- Workflow --

/**
 * @flowWeaver workflow
 * @node val validateContact [position: 250 0]
 * @node norm normalizeContact [position: 500 0]
 * @node fmt formatRecord [position: 750 0]
 * @path Start -> val -> norm -> fmt -> Exit
 * @connect fmt.record -> Exit.record
 * @connect val.onFailure -> Exit.onFailure
 * @connect val.reason -> Exit.reason
 * @position Start 0 0
 * @position Exit 1000 0
 * @param execute [order:0] - Execute
 * @param email [order:1] - Contact email address
 * @param name [order:2] - Contact full name
 * @returns onSuccess [order:0] - Pipeline completed successfully
 * @returns onFailure [order:1] - Validation failed
 * @returns record [order:2] - Formatted CRM record
 * @returns reason [order:3] - Rejection reason (if validation failed)
 */
export function contactPipeline(
  execute: boolean,
  params: { email: string; name: string }
): { onSuccess: boolean; onFailure: boolean; record: string; reason: string } {
  throw new Error('Compile with: flow-weaver compile <file>');
}

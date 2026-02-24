/**
 * RAG Pipeline Template
 * Retrieve → Augment → Generate
 */
import type { WorkflowTemplate, WorkflowTemplateOptions } from '../index';
import { getProviderCode } from '../providers';
import { aiConfigSchema } from './ai-agent';
import { LLM_SIMPLE_TYPES, LLM_MOCK_PROVIDER } from '../shared/llm-types';

export const aiRagTemplate: WorkflowTemplate = {
  id: 'ai-rag',
  name: 'RAG Pipeline',
  description: 'Retrieval-Augmented Generation for knowledge-based Q&A',
  category: 'ai',
  configSchema: aiConfigSchema,

  generate: (opts: WorkflowTemplateOptions): string => {
    const { workflowName, config } = opts;
    const provider = (config?.provider as string) || 'mock';
    const model = (config?.model as string) || '';

    // Get provider-specific code or use mock
    const providerCode =
      provider === 'mock'
        ? `
// Mock provider for testing - replace with real provider
${LLM_MOCK_PROVIDER}
`
        : getProviderCode(provider, model);

    return `
// ============================================================
// LLM TYPES - Provider-agnostic interface
// ============================================================

${LLM_SIMPLE_TYPES}

${providerCode}

// Document store (replace with vector DB like Pinecone, Weaviate, etc.)
interface Document {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

const documentStore: Document[] = [
  // TODO: Add your documents or connect to vector database
  { id: '1', content: 'Flow Weaver is a visual programming tool.' },
  { id: '2', content: 'It uses typed ports for data flow.' },
];

/**
 * Retrieves relevant documents for a query
 *
 * @flowWeaver nodeType
 * @label Retrieve
 * @input query [order:1] - Search query
 * @input topK [order:2] - Number of results (default 3)
 * @input execute [order:0] - Execute
 * @output documents [order:2] - Retrieved documents
 * @output context [order:3] - Combined document text
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function retrieve(
  execute: boolean,
  query: string,
  topK?: number
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  documents: Document[];
  context: string;
}> {
  if (!execute) {
    return { onSuccess: false, onFailure: false, documents: [], context: '' };
  }

  const k = topK ?? 3;

  // TODO: Replace with actual vector similarity search
  // For now, simple keyword matching
  const queryLower = query.toLowerCase();
  const scored = documentStore
    .map((doc) => ({
      doc,
      score: doc.content.toLowerCase().includes(queryLower) ? 1 : 0,
    }))
    .filter((s) => s.score > 0)
    .slice(0, k)
    .map((s) => s.doc);

  const context = scored.map((d) => d.content).join('\\n\\n');

  return {
    onSuccess: true,
    onFailure: false,
    documents: scored,
    context,
  };
}

/**
 * Generates answer using retrieved context
 *
 * @flowWeaver nodeType
 * @label Generate
 * @input question [order:1] - User question
 * @input context [order:2] - Retrieved context
 * @input execute [order:0] - Execute
 * @output answer [order:2] - Generated answer
 * @output sourcesUsed [order:3] - Number of sources used
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
async function generate(
  execute: boolean,
  question: string,
  context: string
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  answer: string;
  sourcesUsed: number;
}> {
  if (!execute) {
    return { onSuccess: false, onFailure: false, answer: '', sourcesUsed: 0 };
  }

  const prompt = \`Answer the question based on the following context.
If the context doesn't contain relevant information, say so.

Context:
\${context}

Question: \${question}

Answer:\`;

  const response = await llmProvider.chat([{ role: 'user', content: prompt }]);
  const sourcesUsed = context
    .split('\\n\\n')
    .filter((s) => s.trim()).length;

  return {
    onSuccess: true,
    onFailure: false,
    answer: response.content ?? '',
    sourcesUsed,
  };
}

/**
 * RAG Pipeline for knowledge-based Q&A
 *
 * @flowWeaver workflow
 * @node retriever retrieve [position: -50 0]
 * @node generator generate [position: 200 0]
 * @position Start -300 0
 * @position Exit 400 0
 * @connect Start.execute -> retriever.execute
 * @connect Start.question -> retriever.query
 * @connect Start.topK -> retriever.topK
 * @connect Start.question -> generator.question
 * @connect retriever.context -> generator.context
 * @connect retriever.onSuccess -> generator.execute
 * @connect generator.answer -> Exit.answer
 * @connect generator.sourcesUsed -> Exit.sourcesUsed
 * @connect generator.onSuccess -> Exit.onSuccess
 * @connect generator.onFailure -> Exit.onFailure
 * @param execute [order:0] - Execute
 * @param question [order:1] - User's question
 * @param topK [order:2] - Number of documents to retrieve
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns answer [order:2] - Generated answer
 * @returns sourcesUsed [order:3] - Number of sources used
 */
export async function ${workflowName}(
  execute: boolean,
  params: { question: string; topK?: number }
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  answer: string;
  sourcesUsed: number;
}> {
  throw new Error('Compile with: flow-weaver compile <file>');
}
`.trim();
  },
};

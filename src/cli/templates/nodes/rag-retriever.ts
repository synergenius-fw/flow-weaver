import type { NodeTemplate } from '../index';
import { toPascalCase } from '../index';

export const ragRetrieverNodeTemplate: NodeTemplate = {
  id: 'rag-retriever',
  name: 'RAG Retriever',
  description: 'Retrieve relevant documents via vector similarity search',
  category: 'ai',
  generate: (name: string): string => {
    const funcName = name || 'ragRetriever';
    const label = toPascalCase(funcName);
    return `
// ============================================================
// VECTOR STORE
// ============================================================
//
// Replace mockRetrieve() with your vector store:
//
//   Pinecone:  const results = await index.query({ vector: embedding, topK });
//   pgvector:  const results = await db.query(
//                'SELECT text, metadata, 1 - (embedding <=> $1) AS score FROM docs ORDER BY score DESC LIMIT $2',
//                [embedding, topK]
//              );
//   Weaviate:  const results = await client.graphql.get()
//                .withClassName('Document')
//                .withNearText({ concepts: [query] })
//                .withLimit(topK)
//                .do();
//   ChromaDB:  const results = await collection.query({ queryTexts: [query], nResults: topK });

interface RetrievedDocument {
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// Mock document store — replace with real vector database
const MOCK_DOCUMENTS: Record<string, RetrievedDocument[]> = {
  default: [
    { text: 'Flow Weaver compiles workflows to standalone TypeScript functions.', score: 0.95, metadata: { source: 'docs/overview.md' } },
    { text: 'The compiler validates connections at compile time, catching errors before runtime.', score: 0.88, metadata: { source: 'docs/compiler.md' } },
    { text: 'Workflows are standard TypeScript files with JSDoc annotations.', score: 0.82, metadata: { source: 'docs/authoring.md' } },
    { text: 'Deploy compiled workflows to Lambda, Vercel, Cloudflare, or Inngest.', score: 0.75, metadata: { source: 'docs/deployment.md' } },
    { text: 'The visual editor provides bidirectional editing — code changes update the canvas and vice versa.', score: 0.71, metadata: { source: 'docs/editor.md' } },
  ],
};

async function mockRetrieve(query: string, collection: string, topK: number): Promise<RetrievedDocument[]> {
  const docs = MOCK_DOCUMENTS[collection] || MOCK_DOCUMENTS['default'] || [];

  // Simple keyword overlap scoring (mock — real stores use vector similarity)
  const queryWords = new Set(query.toLowerCase().split(/\\s+/));
  const scored = docs.map((doc) => {
    const docWords = doc.text.toLowerCase().split(/\\s+/);
    const overlap = docWords.filter((w) => queryWords.has(w)).length;
    const score = Math.min(0.99, overlap / Math.max(queryWords.size, 1) * 0.5 + doc.score * 0.5);
    return { ...doc, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Retrieve relevant documents via vector similarity search.
 * Returns scored documents and a concatenated context string ready for LLM input.
 *
 * @flowWeaver nodeType
 * @label ${label}
 * @color green
 * @icon search
 * @input execute [order:0] - Execute
 * @input query [order:1] - Search query text
 * @input collection [order:2] - Collection/index name
 * @input topK [order:3] - Number of results (optional, default 5)
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 * @output documents [order:2] - Retrieved documents with relevance scores
 * @output context [order:3] - Concatenated document text for LLM context
 */
async function ${funcName}(
  execute: boolean,
  query: string,
  collection: string,
  topK?: number
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  documents: RetrievedDocument[];
  context: string;
}> {
  if (!execute) {
    return {
      onSuccess: false,
      onFailure: false,
      documents: [],
      context: '',
    };
  }

  try {
    const limit = topK ?? 5;
    const documents = await mockRetrieve(query, collection, limit);

    // Concatenate document texts for easy LLM context injection
    const context = documents
      .map((doc, i) => \`[Document \${i + 1} (score: \${doc.score.toFixed(2)})]\n\${doc.text}\`)
      .join('\\n\\n');

    return {
      onSuccess: true,
      onFailure: false,
      documents,
      context,
    };
  } catch (error) {
    console.error('RAG retrieval failed:', error);
    return {
      onSuccess: false,
      onFailure: true,
      documents: [],
      context: '',
    };
  }
}
`.trim();
  },
};

/**
 * Grammar command - output JSDoc grammar as HTML railroad diagrams or EBNF text
 */

import * as fs from 'fs';
import {
  generateGrammarDiagrams,
  getAllGrammars,
  serializedToEBNF,
} from '../../chevrotain-parser/grammar-diagrams.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';

export interface GrammarOptions {
  format?: 'html' | 'ebnf';
  output?: string;
}

export async function grammarCommand(options: GrammarOptions = {}): Promise<void> {
  const { format = 'html', output } = options;

  try {
    let content: string;

    if (format === 'ebnf') {
      const grammars = getAllGrammars();
      const allProductions = [
        ...grammars.port,
        ...grammars.node,
        ...grammars.connect,
        ...grammars.position,
        ...grammars.scope,
      ];
      content = serializedToEBNF(allProductions);
    } else {
      content = generateGrammarDiagrams();
    }

    if (output) {
      fs.writeFileSync(output, content, 'utf-8');
      logger.success(`Grammar written to ${output}`);
    } else {
      process.stdout.write(content);
    }
  } catch (error) {
    logger.error(`Grammar generation failed: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}

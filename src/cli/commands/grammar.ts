import {
  generateGrammarDiagrams,
  getAllGrammars,
  serializedToEBNF,
} from '../../chevrotain-parser/grammar-diagrams.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../../utils/error-utils.js';
import { safeWriteFile } from '../utils/safe-write.js';

export interface GrammarOptions {
  format?: 'html' | 'ebnf';
  output?: string;
}

export async function grammarCommand(options: GrammarOptions = {}): Promise<void> {
  // Default to ebnf on TTY (readable in terminal), html when writing to file
  const defaultFormat = options.output ? 'html' : (process.stdout.isTTY ? 'ebnf' : 'html');
  const { format = defaultFormat, output } = options;

  try {
    let content: string;

    if (format === 'ebnf') {
      const grammars = getAllGrammars();
      const allProductions = [
        ...grammars.port,
        ...grammars.node,
        ...grammars.connect,
        ...grammars.scope,
      ];
      content = serializedToEBNF(allProductions);
    } else {
      content = generateGrammarDiagrams();
    }

    if (output) {
      safeWriteFile(output, content);
      logger.success(`Grammar written to ${output}`);
    } else {
      process.stdout.write(content);
    }
  } catch (error) {
    throw new Error(`Grammar generation failed: ${getErrorMessage(error)}`);
  }
}

/**
 * How a `@flowWeaver nodeType` (or `@flowWeaver node`) JSDoc block becomes a
 * node-type config.
 *
 * Picks the first JSDoc block that declares one, takes the free text above
 * the tags as the description, and reads each tag in order: the presentation
 * tags (`@name`, `@label`, `@color`, `@icon`, `@tag`, ...), execution tags
 * (`@executeWhen`, `@scope`, `@expression`, `@pullExecution`,
 * `@resilience`), ports (see port-tags) and `@deploy`. `@flowWeaver node` is
 * the shorthand for an expression node. A workflow-only tag, or one no
 * handler knows, is a warning (with the closest known tag as a hint); a tag a
 * pack registered goes to its handler.
 */
import type { FunctionLike } from '../function-like';
import { KNOWN_NODETYPE_TAGS, STANDARD_JSDOC_TAGS } from '../../constants';
import { findClosestMatches } from '../../utils/string-distance';
import type { TagHandlerRegistry } from '../tag-registry';
import type { JSDocNodeTypeConfig } from './config-types';
import { parseInputTag, parseOutputTag, parseStepTag } from './port-tags';
import { parseDeployTag } from './runtime-tags';

/**
 * Parse `@resilience retries=N fallback="provider"`: retry/fallback behavior
 * implemented inside the node adapter.
 */
function parseResilience(comment: string, config: JSDocNodeTypeConfig, warnings: string[]): void {
  const resilience: { retries?: number; fallback?: string } = {};
  const attributes = comment.matchAll(/(\w+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g);
  for (const match of attributes) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    if (key === 'retries') {
      const retries = Number(value);
      if (Number.isInteger(retries) && retries > 0) {
        resilience.retries = retries;
      } else {
        warnings.push('@resilience retries must be a positive integer.');
      }
    } else if (key === 'fallback') {
      if (value.trim()) resilience.fallback = value.trim();
    } else {
      warnings.push(`Unknown @resilience option "${key}". Supported options: retries, fallback.`);
    }
  }
  if (resilience.retries !== undefined || resilience.fallback !== undefined) {
    config.resilience = resilience;
  } else {
    warnings.push('@resilience requires retries=N and/or fallback="provider".');
  }
}

/**
 * Parse @flowWeaver nodeType from JSDoc comments.
 * When a TagHandlerRegistry is provided, unknown tags are checked against it
 * before being reported as warnings.
 */
export function parseNodeType(func: FunctionLike, warnings: string[], tagRegistry?: TagHandlerRegistry): JSDocNodeTypeConfig | null {
  const jsdocs = func.getJsDocs();
  if (jsdocs.length === 0) return null;

  // Find the JSDoc block that contains @flowWeaver nodeType (or @flowWeaver node shorthand)
  let jsdoc = null;
  let flowWeaverTag = null;
  let isNodeShorthand = false;

  for (const doc of jsdocs) {
    const tags = doc.getTags();
    const tag = tags.find(
      (t) => {
        if (t.getTagName() !== 'flowWeaver') return false;
        const comment = t.getCommentText()?.trim();
        return comment === 'nodeType' || comment === 'node';
      }
    );
    if (tag) {
      jsdoc = doc;
      flowWeaverTag = tag;
      isNodeShorthand = flowWeaverTag.getCommentText()?.trim() === 'node';
      break;
    }
  }

  if (!jsdoc || !flowWeaverTag) return null;

  const tags = jsdoc.getTags();

  const config: JSDocNodeTypeConfig = {
    inputs: {},
    outputs: {},
  };

  // @flowWeaver node implies expression mode (auto-detect from signature)
  if (isNodeShorthand) {
    config.expression = true;
  }

  // Extract description from JSDoc comment text (before tags)
  const descriptionText = jsdoc.getDescription();
  if (descriptionText && descriptionText.trim()) {
    config.description = descriptionText.trim();
  }

  // Parse tags
  tags.forEach((tag) => {
    const tagName = tag.getTagName();
    const comment = tag.getCommentText() || '';

    switch (tagName) {
      case 'name':
        config.name = comment.trim();
        break;

      case 'label':
        config.label = comment.trim();
        break;

      case 'description':
        config.description = comment.trim();
        break;

      case 'color':
        config.color = comment.trim().replace(/^["']|["']$/g, '');
        break;

      case 'icon':
        config.icon = comment.trim().replace(/^["']|["']$/g, '');
        break;

      case 'tag': {
        config.tags = config.tags || [];
        const tagMatch = comment.match(/^(\S+)(?:\s+"([^"]+)")?$/);
        if (tagMatch) {
          config.tags.push({
            label: tagMatch[1],
            ...(tagMatch[2] && { tooltip: tagMatch[2] }),
          });
        }
        break;
      }

      case 'executeWhen':
        config.executeWhen = comment.trim();
        break;

      case 'scope':
        config.scope = comment.trim();
        break;

      case 'expression':
        config.expression = true;
        break;

      case 'pullExecution': {
        const pullValue = comment.trim();
        if (pullValue) {
          config.defaultConfig = config.defaultConfig || {};
          config.defaultConfig.pullExecution = { triggerPort: pullValue };
        }
        break;
      }

      case 'resilience':
        parseResilience(comment, config, warnings);
        break;

      case 'input':
        parseInputTag(tag, config, func, warnings);
        break;

      case 'output':
        parseOutputTag(tag, config, func, warnings);
        break;

      case 'step':
        parseStepTag(tag, config, func, warnings);
        break;

      case 'deploy':
        config.deploy = config.deploy || {};
        parseDeployTag(tag, config.deploy);
        break;

      default: {
        // D: Context validation - tags that belong to other block types
        if (tagName === 'param' || tagName === 'returns' || tagName === 'return') {
          warnings.push(`@${tagName} is for workflows, not node types. Use @input/@output instead.`);
        } else if (tagRegistry && tagRegistry.has(tagName)) {
          // Delegate to pack-contributed tag handler
          if (!config.deploy) config.deploy = {};
          tagRegistry.handle(tagName, comment, 'nodeType', config.deploy, warnings);
        } else if (!KNOWN_NODETYPE_TAGS.has(tagName) && !STANDARD_JSDOC_TAGS.has(tagName)) {
          // C: Unknown tag detection with suggestions
          const suggestions = findClosestMatches(tagName, [...KNOWN_NODETYPE_TAGS]);
          const hint = suggestions.length > 0 ? ` Did you mean @${suggestions[0]}?` : '';
          warnings.push(`Unknown annotation @${tagName} in nodeType block.${hint}`);
        }
        break;
      }
    }
  });

  return config;
}

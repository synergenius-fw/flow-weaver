/**
 * How a `@flowWeaver workflow` JSDoc block becomes a workflow config.
 *
 * Picks the first JSDoc block that declares one, takes the free text above
 * the tags as the description (in-place compilation regenerates this block
 * from the AST, so anything not captured here is lost on the next compile),
 * and reads each tag in order: identity and options (`@name`, `@description`,
 * `@strictTypes`, `@autoConnect`), the graph (see graph-tags), runtime tags
 * (see runtime-tags), and the `@param`/`@returns` ports (see port-tags). A
 * node-type-only tag, or one no handler knows, is a warning (with the closest
 * known tag as a hint); a tag a pack registered goes to its handler.
 */
import type { FunctionLike } from '../function-like';
import { STANDARD_JSDOC_TAGS, getKnownWorkflowTags } from '../../constants';
import { findClosestMatches } from '../../utils/string-distance';
import type { TagHandlerRegistry } from '../tag-registry';
import type { JSDocWorkflowConfig } from './config-types';
import { parseParamTag, parseReturnTag } from './port-tags';
import {
  positionGone,
  parseImportTag,
  parseNodeTag,
  parseConnectTag,
  parseScopeTag,
  parseMapTag,
  parsePathTag,
  parseFanOutTag,
  parseFanInTag,
  parseCoerceTag,
} from './graph-tags';
import {
  parseTriggerTag,
  parseHttpTag,
  parseCancelOnTag,
  parseRetriesTag,
  parseTimeoutTag,
  parseThrottleTag,
  parseDeployTag,
} from './runtime-tags';

/**
 * Parse @flowWeaver workflow from JSDoc comments.
 * When a TagHandlerRegistry is provided, unknown tags are checked against it
 * before being reported as warnings.
 */
export function parseWorkflow(func: FunctionLike, warnings: string[], tagRegistry?: TagHandlerRegistry): JSDocWorkflowConfig | null {
  const jsdocs = func.getJsDocs();
  if (jsdocs.length === 0) return null;

  // Find the JSDoc block that contains @flowWeaver workflow
  let jsdoc = null;
  let flowWeaverTag = null;

  for (const doc of jsdocs) {
    const tags = doc.getTags();
    const tag = tags.find(
      (t) => t.getTagName() === 'flowWeaver' && t.getCommentText()?.trim() === 'workflow'
    );
    if (tag) {
      jsdoc = doc;
      flowWeaverTag = tag;
      break;
    }
  }

  if (!jsdoc || !flowWeaverTag) return null;

  const tags = jsdoc.getTags();

  const config: JSDocWorkflowConfig = {
    imports: [],
    instances: [],
    connections: [],
    scopes: {},
  };

  // The free text above the tags is the workflow's description, exactly as
  // it is for a node type. It has to be captured here because in-place
  // compilation regenerates this JSDoc block from the AST: whatever is not
  // in the AST is deleted on the next compile. An explicit @description tag
  // below still overrides it.
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

      case 'fwImport':
        // Parse @fwImport nodeName functionName from "packageName"
        // Example: @fwImport npm/autoprefixer/autoprefixer autoprefixer from "autoprefixer"
        parseImportTag(tag, config, warnings);
        break;

      case 'description':
        config.description = comment.trim();
        break;

      case 'strictTypes':
        // @strictTypes with no value or any truthy value = true
        // @strictTypes false = false
        config.strictTypes = comment.trim().toLowerCase() !== 'false';
        break;

      case 'autoConnect':
        // @autoConnect enables automatic linear connection wiring
        // OPT-IN: only applies when present, without it behavior is unchanged
        config.autoConnect = true;
        break;

      case 'node':
        parseNodeTag(tag, config, warnings);
        break;

      case 'position':
        // Positions left the grammar; a file that still carries the line parses, minus the line.
        warnings.push(positionGone(`@position ${comment.trim()}`));
        break;

      case 'connect':
        parseConnectTag(tag, config, warnings);
        break;

      case 'scope':
        parseScopeTag(tag, config, warnings);
        break;

      case 'map':
        parseMapTag(tag, config, warnings);
        break;

      case 'path':
        parsePathTag(tag, config, warnings);
        break;

      case 'fanOut':
        parseFanOutTag(tag, config, warnings);
        break;

      case 'fanIn':
        parseFanInTag(tag, config, warnings);
        break;

      case 'coerce':
        parseCoerceTag(tag, config, warnings);
        break;

      case 'trigger':
        parseTriggerTag(tag, config, warnings, tagRegistry);
        break;

      case 'http':
        parseHttpTag(tag, config, warnings);
        break;

      case 'cancelOn':
        parseCancelOnTag(tag, config, warnings);
        break;

      case 'retries':
        parseRetriesTag(tag, config, warnings);
        break;

      case 'timeout':
        parseTimeoutTag(tag, config, warnings);
        break;

      case 'throttle':
        parseThrottleTag(tag, config, warnings);
        break;

      case 'deploy':
        config.deploy = config.deploy || {};
        parseDeployTag(tag, config.deploy);
        break;

      case 'param':
        parseParamTag(tag, config, func, warnings);
        break;

      case 'return':
      case 'returns':
        parseReturnTag(tag, config, func, warnings);
        break;

      default: {
        // D: Context validation - tags that belong to other block types
        if (tagName === 'color' || tagName === 'icon' || tagName === 'tag') {
          warnings.push(`@${tagName} is for node types, not workflows. Use it on @flowWeaver nodeType instead.`);
        } else if (tagName === 'input' || tagName === 'output' || tagName === 'step') {
          warnings.push(`@${tagName} is for node types, not workflows. Use @param/@returns for workflows.`);
        } else if (tagRegistry && tagRegistry.has(tagName)) {
          // Delegate to pack-contributed tag handler
          if (!config.deploy) config.deploy = {};
          tagRegistry.handle(tagName, comment, 'workflow', config.deploy, warnings);
        } else {
          const knownTags = getKnownWorkflowTags(tagRegistry?.getRegisteredTags());
          if (!knownTags.has(tagName) && !STANDARD_JSDOC_TAGS.has(tagName)) {
            // C: Unknown tag detection with suggestions
            const suggestions = findClosestMatches(tagName, [...knownTags]);
            const hint = suggestions.length > 0 ? ` Did you mean @${suggestions[0]}?` : '';
            warnings.push(`Unknown annotation @${tagName} in workflow block.${hint}`);
          }
        }
        break;
      }
    }
  });

  return config;
}

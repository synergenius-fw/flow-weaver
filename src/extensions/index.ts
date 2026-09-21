/**
 * Extension bootstrap loader.
 *
 * Previously loaded built-in extensions via side-effect imports. Those have
 * been extracted to marketplace packs and are now discovered via pack
 * discovery in the parser (loadPackHandlers) or registered by packs during
 * installation.
 *
 * This file is kept as a no-op to avoid breaking CLI/MCP entry points that
 * import it. It can be removed once those imports are cleaned up.
 */

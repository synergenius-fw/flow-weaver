/**
 * Extension bootstrap loader.
 *
 * Previously loaded built-in CI/CD and Inngest extensions via side-effect
 * imports. Both have been extracted to marketplace packs:
 *
 * - CI/CD: @synergenius/flow-weaver-pack-cicd
 * - Inngest: @synergenius/flow-weaver-pack-inngest
 *
 * Extensions are now discovered via marketplace pack discovery in the parser
 * (loadPackHandlers) or registered by packs during installation.
 *
 * This file is kept as a no-op to avoid breaking CLI/MCP entry points that
 * import it. It can be removed once those imports are cleaned up.
 */

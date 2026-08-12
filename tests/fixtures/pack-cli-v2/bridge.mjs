export async function handleCommandV2(name, context) {
  globalThis.__FW_PACK_CLI_V2_CAPTURE__ = { name, context };
}

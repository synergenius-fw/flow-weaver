// Ambient declarations for optional dependencies (dynamically imported at runtime)

declare module 'fastify' {
  export default function fastify(options?: Record<string, unknown>): unknown;
}

declare module '@fastify/cors' {
  const cors: unknown;
  export default cors;
}

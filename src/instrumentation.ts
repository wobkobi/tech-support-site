// src/instrumentation.ts
/**
 * @description Next.js startup hook. Validates the environment on the Node.js
 * runtime so a misconfigured deploy fails fast at boot rather than mid-request.
 */

/**
 * Runs once when the server process starts. Only validates on the Node.js
 * runtime - the edge runtime does not carry the server secrets being checked.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/shared/lib/env");
    validateEnv();
  }
}

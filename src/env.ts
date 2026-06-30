import { createClient, type RobotRock, type RobotRockConfig } from "./client.js";

const DEFAULT_BASE_URL = "https://api.robotrock.io/v1";

/**
 * Read RobotRock client config from environment variables.
 *
 * - `ROBOTROCK_API_KEY` (required when not passed explicitly)
 * - `ROBOTROCK_BASE_URL` or `ROBOTROCK_API_URL` (optional)
 * - `ROBOTROCK_APP` (optional inbox app bucket)
 */
export function resolveRobotRockConfig(
  overrides?: Partial<RobotRockConfig>
): RobotRockConfig {
  const apiKey = overrides?.apiKey ?? process.env.ROBOTROCK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RobotRock API key is required. Set ROBOTROCK_API_KEY or pass apiKey when creating the client."
    );
  }

  const baseUrl =
    overrides?.baseUrl ??
    process.env.ROBOTROCK_BASE_URL ??
    process.env.ROBOTROCK_API_URL ??
    DEFAULT_BASE_URL;

  const app = overrides?.app ?? process.env.ROBOTROCK_APP;

  return app ? { apiKey, baseUrl, app } : { apiKey, baseUrl };
}

/** Use an explicit client or create one from env / optional config overrides. */
export function resolveRobotRockClient(
  client?: RobotRock,
  configOverrides?: Partial<RobotRockConfig>
): RobotRock {
  if (client) {
    return client;
  }
  return createClient(resolveRobotRockConfig(configOverrides));
}

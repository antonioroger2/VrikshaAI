/**
 * lib/redis-queue.ts — Smart Redis Token Bucket & Waitlist Manager
 *
 * Tracks global RPM/TPM across all instances using a fixed-window token bucket.
 * If limits are saturated, requests join a FIFO waitlist and sleep until the
 * exact second tokens replenish — the "stop and go" behaviour.
 *
 * Uses Upstash Redis REST API for serverless Redis operations.
 * Gracefully no-ops when Upstash credentials are not configured so local dev is unaffected.
 */

// ── Provider Limits ──────────────────────────────────────────────────────────

export const PROVIDER_LIMITS: Record<string, { rpm: number; tpm: number }> = {
  groq:    { rpm: 30,  tpm: 6_000 },
  bedrock: { rpm: 50,  tpm: 200_000 },
  qwen:    { rpm: 20,  tpm: 40_000 },
  gemini:  { rpm: 15,  tpm: 1_000_000 },
};

// ── Upstash Redis REST API Wrapper ──────────────────────────────────────────

interface UpstashRedisConfig {
  baseUrl: string;
  token: string;
}

let _upstashConfig: UpstashRedisConfig | null = null;
let _upstashAvailable = true;

function getUpstashConfig(): UpstashRedisConfig | null {
  if (!_upstashAvailable) return null;
  if (_upstashConfig) return _upstashConfig;

  const baseUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!baseUrl || !token) {
    _upstashAvailable = false;
    return null;
  }

  _upstashConfig = { baseUrl, token };
  return _upstashConfig;
}

async function upstashCommand(command: string, args: any[] = []): Promise<any> {
  const config = getUpstashConfig();
  if (!config) throw new Error('Upstash Redis not configured');

  const response = await fetch(`${config.baseUrl}/${command}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    throw new Error(`Upstash Redis error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result.result;
}

async function upstashPipeline(commands: Array<{ command: string; args: any[] }>): Promise<any[]> {
  const config = getUpstashConfig();
  if (!config) throw new Error('Upstash Redis not configured');

  const pipeline = commands.map(({ command, args }) => [command.toUpperCase(), ...args]);

  const response = await fetch(`${config.baseUrl}/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(pipeline),
  });

  if (!response.ok) {
    throw new Error(`Upstash Redis pipeline error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result.map((r: any) => r.result);
}

// ── Lazy Redis Connection ────────────────────────────────────────────────────

let _redisAvailable = true; // set false after first connection failure

async function getRedis(): Promise<{ available: boolean } | null> {
  if (!_redisAvailable) return null;
  const config = getUpstashConfig();
  if (!config) {
    _redisAvailable = false;
    return null;
  }

  // Test connection
  try {
    await upstashCommand('ping');
    return { available: true };
  } catch {
    _redisAvailable = false;
    return null;
  }
}

// ── Core Waitlist Function ────────────────────────────────────────────────────

/**
 * Wait until the provider has capacity for this request.
 *
 * @param provider       - API provider key ('groq', 'bedrock', 'qwen', 'gemini')
 * @param estimatedTokens - Token count expected for this call
 * @param onWaitlist     - Callback fired whenever we are queued (position, waitMs)
 */
export async function waitForCapacity(
  provider: string,
  estimatedTokens: number,
  onWaitlist: (position: number, waitTimeMs: number) => void
): Promise<void> {
  const redis = await getRedis();

  // If Redis is unavailable, skip — withSmartRetries handles raw 429s via backoff.
  if (!redis) return;

  const limits = PROVIDER_LIMITS[provider];
  if (!limits) return;

  // Unique ID for this request's slot in the queue
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const queueKey = `queue:vriksha:${provider}`;

  // Max loop iterations to avoid infinite spin on misconfigured Redis
  const MAX_WAITS = 10;

  for (let waitCount = 0; waitCount < MAX_WAITS; waitCount++) {
    const currentMinute = Math.floor(Date.now() / 60_000);
    const rpmKey = `rate_limit:vriksha:${provider}:rpm:${currentMinute}`;
    const tpmKey = `rate_limit:vriksha:${provider}:tpm:${currentMinute}`;

    // Enter the waitlist to claim a position
    const position = await upstashCommand('rpush', [queueKey, requestId]);

    // Read current usage
    const [rpmRaw, tpmRaw] = await Promise.all([
      upstashCommand('get', [rpmKey]),
      upstashCommand('get', [tpmKey]),
    ]);
    const currentRpm = parseInt(rpmRaw || '0', 10);
    const currentTpm = parseInt(tpmRaw || '0', 10);

    const hasRpm = currentRpm < limits.rpm;
    const hasTpm = (currentTpm + estimatedTokens) <= limits.tpm;
    const isFirst = position === 1;

    if (hasRpm && hasTpm && isFirst) {
      // Claim tokens atomically and leave the queue
      await upstashPipeline([
        { command: 'incr', args: [rpmKey] },
        { command: 'incrby', args: [tpmKey, estimatedTokens] },
        { command: 'expire', args: [rpmKey, 65] },
        { command: 'expire', args: [tpmKey, 65] },
        { command: 'lrem', args: [queueKey, 1, requestId] },
      ]);
      return; // Proceed with the API call
    }

    // Remove our slot — we will re-queue after sleeping
    await upstashCommand('lrem', [queueKey, 1, requestId]);

    // Calculate precise wait until the current minute window resets
    const msUntilNextMinute = 60_000 - (Date.now() % 60_000) + 100;

    // Notify UI/logger
    onWaitlist(position, msUntilNextMinute);

    // Stop and go ⏸️
    await new Promise(resolve => setTimeout(resolve, msUntilNextMinute));
  }

  // If we exhausted MAX_WAITS, proceed anyway and let a potential 429 be caught
  // by withSmartRetries' catch block.
}

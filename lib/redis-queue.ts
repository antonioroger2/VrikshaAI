/**
 * lib/redis-queue.ts — Smart Redis Token Bucket & Waitlist Manager
 *
 * Tracks global RPM/TPM across all instances using a fixed-window token bucket.
 * If limits are saturated, requests join a FIFO waitlist and sleep until the
 * exact second tokens replenish — the "stop and go" behaviour.
 *
 * Gracefully no-ops when REDIS_URL is not configured so local dev is unaffected.
 */

// ── Provider Limits ──────────────────────────────────────────────────────────

export const PROVIDER_LIMITS: Record<string, { rpm: number; tpm: number }> = {
  groq:    { rpm: 30,  tpm: 6_000 },
  bedrock: { rpm: 50,  tpm: 200_000 },
  qwen:    { rpm: 20,  tpm: 40_000 },
  gemini:  { rpm: 15,  tpm: 1_000_000 },
};

// ── Lazy Redis Connection ────────────────────────────────────────────────────

let _redis: import('ioredis').Redis | null = null;
let _redisAvailable = true; // set false after first connection failure

async function getRedis(): Promise<import('ioredis').Redis | null> {
  if (!_redisAvailable) return null;
  if (_redis) return _redis;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    _redisAvailable = false;
    return null;
  }

  try {
    const { default: Redis } = await import('ioredis');
    _redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 3000,
    });

    _redis.on('error', () => {
      // Silently mark Redis as unavailable so we fall back to dumb retries
      _redisAvailable = false;
      _redis = null;
    });

    await _redis.connect();
    return _redis;
  } catch {
    _redisAvailable = false;
    _redis = null;
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
    const position = await redis.rpush(queueKey, requestId);

    // Read current usage
    const [rpmRaw, tpmRaw] = await Promise.all([
      redis.get(rpmKey),
      redis.get(tpmKey),
    ]);
    const currentRpm = parseInt(rpmRaw || '0', 10);
    const currentTpm = parseInt(tpmRaw || '0', 10);

    const hasRpm = currentRpm < limits.rpm;
    const hasTpm = (currentTpm + estimatedTokens) <= limits.tpm;
    const isFirst = position === 1;

    if (hasRpm && hasTpm && isFirst) {
      // Claim tokens atomically and leave the queue
      const multi = redis.multi();
      multi.incr(rpmKey);
      multi.incrby(tpmKey, estimatedTokens);
      multi.expire(rpmKey, 65); // slightly over 60s for safety
      multi.expire(tpmKey, 65);
      multi.lrem(queueKey, 1, requestId);
      await multi.exec();
      return; // Proceed with the API call
    }

    // Remove our slot — we will re-queue after sleeping
    await redis.lrem(queueKey, 1, requestId);

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

/**
 * Utility functions for VRIKSHA.ai
 */

/**
 * Automatically retries an API call with exponential backoff.
 * Useful for handling 429 Too Many Requests or transient network errors.
 */
export async function withRetries<T>(
  apiCall: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      if (attempt === maxRetries) throw error; // Give up on last attempt

      const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
      console.warn(`API error, retrying in ${waitTime}ms (Attempt ${attempt + 1}/${maxRetries})...`, error);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw new Error("API request failed after maximum retries.");
}
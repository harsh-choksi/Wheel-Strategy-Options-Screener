function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  return function rateLimit(key) {
    const now = Date.now();
    const bucket = hits.get(key) || { count: 0, resetAt: now + windowMs };

    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    hits.set(key, bucket);

    return {
      allowed: bucket.count <= max,
      resetAt: bucket.resetAt
    };
  };
}

module.exports = {
  createRateLimiter
};

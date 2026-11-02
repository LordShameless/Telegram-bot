const { createClient } = require("redis");

// Redis connection (free tier, no auth needed for local dev)
const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redis.on("error", (err) => console.error("Redis error:", err));

// In-memory map for named queues (persists across invocations in serverless is tricky,
// but we'll use Redis with JSON strings for true persistence)
// For simplicity, we use Redis with JSON for all queue data.

const getRedis = () => redis;

module.exports = { redis, getRedis };

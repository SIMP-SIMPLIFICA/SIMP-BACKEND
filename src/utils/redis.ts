import { createClient } from 'redis'
import { config } from '@/config/config.js'
import { logger } from './logger.js'

export const redisClient = createClient({
  url: config.redis.url,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: retries => {
      if (retries > 10) return false
      return Math.min(retries * 50, 1000)
    }
  }
})

redisClient.on('connect', () => logger.info('🔗 Redis connected'))
redisClient.on('error', (error: any) => logger.error(error, '❌ Redis error'))

export async function connectRedis() {
  try {
    await redisClient.connect()
  } catch (error: any) {
    logger.error(error, 'Redis connection failed')
    throw error
  }
}

export const redis = {
  get: (key: string) => redisClient.get(key) as Promise<string | null>,
  set: (key: string, value: string, ttl?: number) =>
    ttl ? redisClient.setEx(key, ttl, value) : redisClient.set(key, value),
  del: (key: string) => redisClient.del(key),
  exists: (key: string) => redisClient.exists(key),
  setJSON: (key: string, value: any, ttl?: number) =>
    ttl ? redisClient.setEx(key, ttl, JSON.stringify(value)) : redisClient.set(key, JSON.stringify(value)),
  getJSON: async <T>(key: string): Promise<T | null> => {
    const value = await redisClient.get(key) as string | null
    return value ? JSON.parse(value) : null
  },
  scan: (cursor: number, pattern?: string, count?: number) =>
    redisClient.scan(cursor.toString(), pattern ? { MATCH: pattern, COUNT: count } : { COUNT: count }),
  incrementRateLimit: async (key: string, window: number, limit: number) => {
    const result = await redisClient.incr(key)
    const current = Number(result)
    
    if (current === 1) await redisClient.expire(key, window)
    
    const now: number = Date.now()
    const windowMs: number = window * 1000
    const resetTime: number | null = current === 1 ? now + windowMs : null

    return {
      count: current,
      remaining: Math.max(0, limit - current),
      resetTime: resetTime
    }
  }
}

export default redis
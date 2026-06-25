-- Atomic increment WITHOUT the WAL stream or pub/sub publish.
-- For drivers that have no WAL / realtime capability (e.g. Upstash REST).
-- KEYS[1] = usage counter key
-- KEYS[2] = metadata hash key
-- ARGV[1] = amount (delta)
-- ARGV[2] = now_ms
-- Returns: { newTotal, resetOccurred, lastResetAt }

local counterKey = KEYS[1]
local metaKey    = KEYS[2]
local amount     = tonumber(ARGV[1])
local now_ms     = tonumber(ARGV[2])

local metaData = redis.call('HGETALL', metaKey)
local meta = {}
for i = 1, #metaData, 2 do
    meta[metaData[i]] = metaData[i + 1]
end

local resetValue  = tonumber(meta['resetValue'] or '0')
local resetAt     = tonumber(meta['resetAt'])
local lastResetAt = tonumber(meta['lastResetAt'] or '0')
local resetOccurred = 0

local raw = redis.call('GET', counterKey)
local current
if raw == false then
    current = resetValue
    redis.call('SET', counterKey, current)
else
    current = tonumber(raw)
end

if resetAt and now_ms >= resetAt then
    current = resetValue
    redis.call('SET', counterKey, current)
    lastResetAt = now_ms
    redis.call('HSET', metaKey, 'lastResetAt', now_ms)
    redis.call('HDEL', metaKey, 'resetAt')
    resetOccurred = 1
end

local newTotal = current + amount
redis.call('SET', counterKey, newTotal)

return { newTotal, resetOccurred, lastResetAt }

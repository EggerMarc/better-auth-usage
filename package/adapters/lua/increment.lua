-- KEYS[1] = usage counter key (e.g. usage:api-calls:user-123)
-- KEYS[2] = metadata hash key (e.g. limit:api-calls:user-123)
-- ARGV[1] = amount (delta to apply)
-- ARGV[2] = now_ms (epoch milliseconds)

local counterKey = KEYS[1]
local metaKey    = KEYS[2]
local amount     = tonumber(ARGV[1])
local now_ms     = tonumber(ARGV[2])

-- Load metadata hash
local metaData = redis.call('HGETALL', metaKey)
local meta = {}
for i = 1, #metaData, 2 do
    meta[metaData[i]] = metaData[i + 1]
end

local resetValue  = tonumber(meta['resetValue'] or '0')
local resetAt     = tonumber(meta['resetAt'])
local lastResetAt = tonumber(meta['lastResetAt'] or '0')
local resetOccurred = 0

-- Get current counter (default to resetValue if key doesn't exist)
local raw = redis.call('GET', counterKey)
local current
if raw == false then
    current = resetValue
    redis.call('SET', counterKey, current)
else
    current = tonumber(raw)
end

-- Check if reset boundary has been crossed
if resetAt and now_ms >= resetAt then
    current = resetValue
    redis.call('SET', counterKey, current)
    lastResetAt = now_ms
    redis.call('HSET', metaKey, 'lastResetAt', now_ms)
    resetOccurred = 1
end

-- Apply the delta AFTER any reset
local newTotal = current + amount
redis.call('SET', counterKey, newTotal)

return { newTotal, resetOccurred, lastResetAt }

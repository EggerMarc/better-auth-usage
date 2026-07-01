// Lua scripts inlined as strings (not `.lua` imports) so the modules load in
// any runtime — node (better-auth CLI), bun, esbuild — without a text loader.

/** Atomic increment + reset-boundary + WAL XADD + pub/sub publish. */
export const incrementScript = `
-- KEYS[1] = usage counter key (e.g. usage:api-calls:user-123)
-- KEYS[2] = metadata hash key (e.g. meta:api-calls:user-123)
-- KEYS[3] = WAL stream key (e.g. wal:usage)
-- ARGV[1] = amount (delta to apply)
-- ARGV[2] = now_ms (epoch milliseconds)
-- ARGV[3] = referenceId
-- ARGV[4] = feature key
-- ARGV[5] = event name (e.g. "use")

local counterKey = KEYS[1]
local metaKey    = KEYS[2]
local walKey     = KEYS[3]
local amount     = tonumber(ARGV[1])
local now_ms     = tonumber(ARGV[2])
local refId      = ARGV[3]
local feature    = ARGV[4]
local event      = ARGV[5]

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

redis.call('XADD', walKey, '*',
    'refId', refId,
    'feature', feature,
    'amount', amount,
    'event', event,
    'ts', now_ms,
    'resetOccurred', resetOccurred,
    'newTotal', newTotal,
    'lastResetAt', lastResetAt
)

if cjson then
    local channel = 'usage:events:' .. feature .. ':' .. refId
    redis.call('PUBLISH', channel, cjson.encode({
        refId = refId,
        feature = feature,
        amount = amount,
        newTotal = newTotal,
        event = event,
        ts = now_ms
    }))
end

return { newTotal, resetOccurred, lastResetAt }
`

/** Atomic increment + reset-boundary only (no WAL/pub-sub). For Upstash REST. */
export const incrementSimpleScript = `
-- KEYS[1] = usage counter key
-- KEYS[2] = metadata hash key
-- ARGV[1] = amount (delta)
-- ARGV[2] = now_ms

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
`

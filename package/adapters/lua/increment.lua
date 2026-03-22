local key = KEYS[1]
local limitKey = KEYS[2]
local amount = tonumber(ARGV[1])
local now = tonumber(ARGV[2])

-- Need to store limit as hash (HSET)
local limitData = redis.call('HGETALL', limitKey)

local limit = {}
for i = 1, #limitData, 2 do
    limit[limitData[i]] = limitData[i + 1]
end

local resetValue = tonumber(limit.resetValue or '0')
local resetAt = tonumber(limit.resetAt)

local current = tonumber(
    redis.call('GET', key) or
    resetValue
)

local newAmount = current + amount

if resetAt and now > resetAt then
    current = resetValue
    redis.call('DEL', key)
    redis.call('SET', key, resetValue)
    redis.call('INCRBY', key, amount)
    redis.call('EXPIREAT', key, resetAt)
    return { newAmount, resetAt }
end

if resetAt then
    redis.call('EXPIREAT', key, resetAt)
end

redis.call('INCRBY', key, amount)
return { newAmount, nil }

local key = KEYS[1]
local limitKey = KEYS[2]
local amount = tonumber(ARGV[1])
local now = tonumber(ARGV[2])

local limitData = redis.call('HGETALL', limitKey)

local limit = {}
for i = 1, #limitData, 2 do
    limit[limitData[i]] = limitData[i + 1]
end

local resetValue = tonumber(limit.resetValue or '0')
local resetAt = tonumber(limit.resetAt or '0')

local current = tonumber(
    redis.call('GET', key) or
    resetValue
)

if now > resetAt then
    current = resetValue
    redis.call('DEL', key)
end

local newAmount = current + amount

redis.call('INCRBY', key, newAmount)
redis.call('EXPIREAT', key, resetAt)
return { newAmount, resetAt }


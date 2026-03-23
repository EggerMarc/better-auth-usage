-- KEYS[1] = metadata hash key (e.g. meta:api-calls:user-123)
-- ARGV[1] = referenceId
-- ARGV[2] = feature key
-- ARGV[3] = lastResetAt (epoch_ms)
-- ARGV[4] = resetAt (epoch_ms, optional — pass "0" to skip)
-- ARGV[5] = maxLimit (optional — pass "0" to skip)
-- ARGV[6] = minLimit (optional — pass "0" to skip)
-- ARGV[7] = resetValue (optional — pass "0" to skip)

local metaKey = KEYS[1]

redis.call('HSET', metaKey,
    'referenceId', ARGV[1],
    'feature', ARGV[2],
    'lastResetAt', ARGV[3]
)

if ARGV[4] ~= "0" then
    redis.call('HSET', metaKey, 'resetAt', ARGV[4])
end

if ARGV[5] ~= "0" then
    redis.call('HSET', metaKey, 'maxLimit', ARGV[5])
end

if ARGV[6] ~= "0" then
    redis.call('HSET', metaKey, 'minLimit', ARGV[6])
end

if ARGV[7] ~= "0" then
    redis.call('HSET', metaKey, 'resetValue', ARGV[7])
end

return 1

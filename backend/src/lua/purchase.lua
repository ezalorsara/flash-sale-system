-- KEYS[1] = stock counter key
-- KEYS[2] = purchased-users set key
-- ARGV[1] = userId
--
-- Runs as a single atomic step inside Redis's single-threaded command
-- execution, so no two concurrent callers can ever interleave between the
-- "check" and the "act" here -- that gap is exactly what would otherwise
-- cause overselling or double-purchases under load.
--
-- Returns:
--  -2 stock counter not initialized (sale not seeded yet)
--  -1 duplicate (this user already has a reservation)
--   0 sold out (no stock left)
--   1 reserved (stock decremented, user recorded)

local stockRaw = redis.call('GET', KEYS[1])
if stockRaw == false then
  return -2
end

if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
  return -1
end

local stock = tonumber(stockRaw)
if stock <= 0 then
  return 0
end

redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[2], ARGV[1])
return 1

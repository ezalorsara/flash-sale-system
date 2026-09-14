-- KEYS[1] = stock counter key
-- KEYS[2] = purchased-users set key
-- ARGV[1] = userId
--
-- Rolls back a reservation made by purchase.lua when the durable Mongo
-- write that must follow it fails. Also atomic, so a rollback can never be
-- observed half-applied by a concurrent purchase attempt for the same user.

redis.call('INCR', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[1])
return 1

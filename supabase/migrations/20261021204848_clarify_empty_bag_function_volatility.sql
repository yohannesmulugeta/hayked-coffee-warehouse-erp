-- These authorization checks call VOLATILE role guards. Keep the function
-- declarations consistent so PostgreSQL does not optimize them as stable reads.
alter function private.validate_empty_bag_charge(uuid, uuid, date, date, text) volatile;
alter function public.empty_bag_daily_statement(uuid, date, date) volatile;

-- The quote checks the signed-in user's role before returning a calculation,
-- so it must remain volatile rather than being advertised as a stable routine.
alter function public.quote_storage_billing(uuid, uuid, text, date, date, boolean, text)
  volatile;

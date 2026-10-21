-- The quote calls a VOLATILE authorization and tariff validator.
alter function public.quote_empty_bag_charge(uuid, uuid, date, date, text) volatile;

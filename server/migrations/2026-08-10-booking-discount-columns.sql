-- Records the tier discount (if any) applied automatically at checkout by
-- POST /api/bookings, via server/membership-benefits.js. `price` keeps
-- meaning exactly what it means today (the amount actually charged);
-- these two columns are additive context for admin/kapster visibility.
-- Both nullable: existing rows and any booking with no applicable
-- discount leave both null.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS original_price INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS discount_label TEXT;

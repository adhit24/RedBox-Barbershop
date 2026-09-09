-- Migration: Add barber_shifts table and bookings compound index for Command Center V1

CREATE TABLE IF NOT EXISTS public.barber_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id TEXT NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  shift_type TEXT DEFAULT 'regular', -- 'regular' | 'morning' | 'evening' | 'full'
  is_off BOOLEAN NOT NULL DEFAULT false,
  start_time TIME,
  end_time TIME,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_barber_shift_date UNIQUE (barber_id, shift_date)
);

CREATE INDEX IF NOT EXISTS idx_barber_shifts_date_barber ON public.barber_shifts (shift_date, barber_id);

-- Compound index for fast operational filtering in Command Center
CREATE INDEX IF NOT EXISTS idx_bookings_date_location ON public.bookings (date, location);
CREATE INDEX IF NOT EXISTS idx_bookings_date_location_status ON public.bookings (date, location, status);

-- RLS for barber_shifts
ALTER TABLE public.barber_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on barber_shifts" ON public.barber_shifts;
CREATE POLICY "Allow public read access on barber_shifts"
  ON public.barber_shifts FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow service role full access on barber_shifts" ON public.barber_shifts;
CREATE POLICY "Allow service role full access on barber_shifts"
  ON public.barber_shifts FOR ALL
  USING (true)
  WITH CHECK (true);

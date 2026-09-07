-- Migration: Create employees table for regular salaried employees
-- Redbox Barbershop & Sundaze Cafe

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique,
  name text not null,
  nickname text,
  business_unit text not null, -- 'Redbox' | 'Sundaze'
  branch text,                 -- 'bypass' | 'csb' | 'samadikun' | 'sumber' | 'tegal'
  branch_name text,            -- 'Bypass' | 'CSB' | 'Samadikun' | 'Sumber' | 'Tegal'
  position text not null,      -- 'Helper Cashier' | 'Cashier' | 'Barista' | 'Cook' | 'Waitress' | 'Waiter' | 'Greeter' | 'Umum' | 'Staff'
  employment_type text default 'regular',
  payroll_type text default 'salary',
  is_active boolean default true,
  join_date date,
  base_salary numeric,
  source text,
  source_period text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS policies
alter table public.employees enable row level security;

drop policy if exists "Allow public read access on employees" on public.employees;
create policy "Allow public read access on employees"
  on public.employees for select
  using (true);

drop policy if exists "Allow service role full access on employees" on public.employees;
create policy "Allow service role full access on employees"
  on public.employees for all
  using (true)
  with check (true);

-- Indexes for performance
create index if not exists idx_employees_business_unit on public.employees(business_unit);
create index if not exists idx_employees_is_active on public.employees(is_active);
create index if not exists idx_employees_branch on public.employees(branch);

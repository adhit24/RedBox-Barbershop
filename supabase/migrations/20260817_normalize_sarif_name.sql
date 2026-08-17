-- MokaPOS canonical name is Sarif (not Syarif).
update public.barbers
set name = 'Sarif'
where id = 'csb-syarif'
  and name = 'Syarif';

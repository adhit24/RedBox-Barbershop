import { apiClient } from '../lib/apiClient';

export type WorkforceFilter = 'all' | 'redbox' | 'sundaze';

export interface HRPerson {
  id: string;
  source: 'barbers' | 'employees';
  source_record_id: string;
  name: string;
  nickname: string | null;
  business_unit: string;
  position: string;
  branch: string | null;
  branch_name: string | null;
  employment_type: string;
  payroll_type: string | null;
  attendance_status: null;
  is_active: boolean;
}

export interface HRPeopleResponse {
  source: 'database';
  filter: WorkforceFilter;
  kpis: {
    active_barbers: number;
    regular_employees: number;
    barber_branches: number;
    active_business_units: number;
  };
  people: HRPerson[];
  attendance: { available: false; label: 'Belum tersedia' };
  reconciliation: {
    owner_expected_active_barbers: number;
    status: 'pending_owner_review';
  };
}

export function getHRPeople(filter: WorkforceFilter): Promise<HRPeopleResponse> {
  return apiClient.get<HRPeopleResponse>(`/api/admin/hr-people?filter=${encodeURIComponent(filter)}`);
}

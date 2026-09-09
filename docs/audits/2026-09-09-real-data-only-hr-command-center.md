# Real Data Only — HR & People and Command Center

Audit snapshot: 9 September 2026 (Asia/Jakarta)
Production Supabase project: `khcvklzxfohwkyocenaf`

## Executive Summary

- HR & People now reads active workforce records directly from `public.barbers` and `public.employees`; no import or production mutation is part of this change.
- Production contains 28 active barbers and 39 active regular employees. Database records are treated as authoritative identities (`barber:<barbers.id>` and `employee:<employees.id>`), yielding 67 active directory rows without unsafe name/position heuristic deduplication.
- Active barber reconciliation status:
  - Production database truth: 28 active barbers
  - Owner historical expectation: 27
  - Status: requires owner reconciliation
  Three transferred-looking ID/branch mismatches need owner review, but this evidence does not identify which one person should be inactive.
- Command Center technical log cards, placeholder controls, and attendance-absence-derived owner alerts were removed. Honest unavailable states remain visible as `—`.

## Workforce Metric Definitions

| Metric | Definition | Current production result |
|---|---|---:|
| Kapster Aktif | Active rows in `public.barbers` | 28 |
| Karyawan Reguler | Active rows in `public.employees` with `employment_type = regular` | 39 |
| Cabang dengan Kapster | Distinct branch among active barber rows | 5 |
| Unit Bisnis Live | Distinct active workforce business unit after unified mapping | 2 |
| Direktori Aktif | Active barber and regular-employee rows (database records treated as authoritative identities) | 67 |

The employee snapshot contains Redbox 16 and Sundaze 23. All 39 rows use payroll type `salary` and source period `26 Juli - 25 Agustus 2026`.

## Active Barber Reconciliation

```text
Production database truth:
28 active barbers

Owner historical expectation:
27

Status:
requires owner reconciliation
```

| Name | ID | Branch | Active |
|---|---|---|---|
| Abdul | `bypass-abdul-dul` | bypass | true |
| Ari | `bypass-ari` | bypass | true |
| Bob | `bypass-bob` | bypass | true |
| Didi | `sumber-didi` | bypass | true |
| dodi | `bypass-dodi` | bypass | true |
| Onoy | `bypass-onoy` | bypass | true |
| Aziz | `sumber-aziz` | csb | true |
| Ega | `csb-ega` | csb | true |
| Husen | `csb-husen` | csb | true |
| Ragil | `csb-ragil` | csb | true |
| Sarif | `csb-syarif` | csb | true |
| Ubay | `csb-ubay` | csb | true |
| Yudha | `csb-yudha` | csb | true |
| Aden | `samadikun-aden` | samadikun | true |
| hamami | `samadikun-hamami` | samadikun | true |
| Miftah | `samadikun-miftah` | samadikun | true |
| Sofyan | `samadikun-sofyan` | samadikun | true |
| Bayu | `sumber-bayu` | sumber | true |
| Opan | `samadikun-opan` | sumber | true |
| Prima | `sumber-prima` | sumber | true |
| Putra | `sumber-putra` | sumber | true |
| Sigit | `sumber-sigit` | sumber | true |
| Ahmad | `tegal-ahmad` | tegal | true |
| Epik | `tegal-epik` | tegal | true |
| Faiz | `tegal-faiz` | tegal | true |
| Sephril | `tegal-sephril` | tegal | true |
| wawan | `tegal-wawan` | tegal | true |
| Yafi | `tegal-yafi` | tegal | true |

Branch totals: Bypass 6, CSB 7, Samadikun 4, Sumber 5, Tegal 6.

### Inactive Rows

| Name | ID | Branch | Active |
|---|---|---|---|
| Anggi | `csb-anggi` | csb | false |

### Records Requiring Owner Review

| Name | Current ID | Current branch | Finding |
|---|---|---|---|
| Didi | `sumber-didi` | bypass | ID prefix references Sumber; current branch is Bypass |
| Aziz | `sumber-aziz` | csb | ID prefix references Sumber; current branch is CSB |
| Opan | `samadikun-opan` | sumber | ID prefix references Samadikun; current branch is Sumber |

No duplicate-looking active names were found after case/punctuation normalization. Every current branch value belongs to the five recognized Redbox branches. ID-prefix mismatches are consistent with transfers and are not proof that a record should be inactive.

## Command Center Source-of-Truth Audit

| Metric / card | UI label | Service / API | Database source | Filter | Time window | Fallback | Classification |
|---|---|---|---|---|---|---|---|
| Today's bookings | Booking Hari Ini | `/api/admin/crm/command-center` | `bookings` | selected branch | Jakarta current day | error state | REAL |
| Completed services | Completed Services | none | none with an approved Command Center window | none | unavailable | `—` | UNAVAILABLE |
| Repeat customers | Repeat Customers | `/api/admin/crm/customer-segments` | completed `bookings`, completed `transactions`, plus linked customer/outlet/barber/item rows | selected branch | all covered visits | error state | REAL |
| Attendance KPI | Attendance Alerts | none accepted for owner KPI | attendance coverage is not proven complete | none | current day | `—` | UNAVAILABLE |
| Active paid members | Active Members | `/api/admin/crm/membership` | `member_profiles`, enriched with `customers.last_visit` | network-wide only | current status | error state | REAL BUT PARTIAL |
| Payroll status | Payroll Pending | none | no official payroll-status source | none | unavailable | `—` | UNAVAILABLE |
| Attendance priority | Attendance Issues | none accepted for owner alerting | attendance coverage is not proven complete | none | current day | `—` | UNAVAILABLE |
| Payroll priority | Payroll Pending | none | no official payroll-status source | none | unavailable | `—` | UNAVAILABLE |
| Booking priority | Booking Issues | `/api/admin/crm/command-center` | `bookings.status = pending` | selected branch | Jakarta current day | error state | REAL |
| Inventory priority | Low Stock Alerts | none available to Backoffice | Stockist read path not connected | none | unavailable | `—` | UNAVAILABLE |
| Business performance | Business Performance | `/api/admin/business-performance` | `business_performance_daily` | selected branch | 2026 year/month | audited Jan-Aug Moka CSV history | REAL / REAL_HISTORICAL_FALLBACK |
| Branch activity | Live Branch Activity | `/api/admin/crm/command-center` | booking totals and pending status from `bookings` | selected branch | Jakarta current day | error state | REAL |
| Owner actions | Action Center | `/api/admin/crm/command-center` | pending `bookings` only | selected branch | Jakarta current day | empty state | REAL |
| Customer overview | Customer Snapshot | `/api/admin/crm/customer-segments` | completed booking/transaction visit history | selected branch | all covered visits | no fabricated substitute | REAL |
| Branch snapshot | Branch Performance | `/api/admin/crm/command-center` | booking totals and pending status | selected branch | Jakarta current day | no fabricated substitute | REAL |
| Barber overview | Barber Performance | `/api/admin/crm/barber-performance` | completed visit rows with resolvable barber IDs | selected branch | all covered visits | no fabricated substitute | REAL BUT PARTIAL |
| Membership overview | Membership Snapshot | `/api/admin/crm/membership` | `member_profiles`, `customers` | network-wide only | current status/month activation | no fabricated substitute | REAL BUT PARTIAL |
| Inventory overview | Inventory Snapshot | no Backoffice read path | Stockist remains operational authority | none | unavailable | `—` / UNAVAILABLE | UNAVAILABLE |
| Payroll overview | Payroll Snapshot | none | no official payroll-status endpoint | none | unavailable | `—` / UNAVAILABLE | UNAVAILABLE |

## Removed Owner-Facing Sources

- `Today's Operations Timeline`: real Moka synchronization logs, but technical observability rather than owner decision data. UI and fetch/state were removed; Moka logs remain available in their technical module.
- `Alerts & Exceptions`: real synchronization failures, but technical observability. UI was removed without deleting logging routes.
- Attendance-derived Action Center and branch status: absence of a `barber_attendance` row had been interpreted as “belum check-in.” Until attendance coverage is proven complete, that is not a reliable owner alert.
- Disabled Search and Notification buttons: nonfunctional placeholders were removed.
- HR hardcoded `Unit Bisnis Live = 1`: replaced by a distinct database-derived count.

No production Command Center mock array, random value, demo seed KPI, or fabricated percentage trend was found. The audited Jan-Aug performance fallback remains allowed because it originates from real historical Moka exports.

## Recommended Next Steps

1. Owner identifies which active barber should be inactive after reviewing the 28-row roster and transfer mismatches:
   - Production database truth: 28 active barbers
   - Owner historical expectation: 27
   - Status: requires owner reconciliation
2. Future review: confirm whether managers should have network-wide HR visibility across Redbox and Sundaze, or whether HR access must be owner-scoped / branch-scoped.
3. Database records are authoritative identities. If duplicate physical people legitimately exist across `barbers` and `employees`, resolve this in the future via an explicit identity-link field in the database rather than heuristic name/position deduplication.
4. Define attendance completeness and a check-in authority before re-enabling attendance KPIs or alerts.
5. Expose a read-only Stockist summary and an official payroll-status endpoint before replacing those unavailable cards.

## Caveats

- This is a production snapshot, not a mutation or a scheduled reconciliation.
- Active-member data cannot currently be attributed safely to a selected branch.
- Barber performance includes only visits whose barber identity is resolvable; it is not the canonical active-roster count.
- Employee source metadata needs owner review: all 39 rows state source period `26 Juli - 25 Agustus 2026`, but the 23 Sundaze rows reference `Laporan_Gaji_GAJI_SUNDAZE_AGUSTUS_2025.csv`. Counts use the production rows as stored; this filename/period mismatch is not silently corrected.
- The aggregate workforce composition chart provides context; exact reconciliation and source-authority decisions still use the row-level tables.

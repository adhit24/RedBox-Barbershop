import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { BackofficeLayout } from './layouts/BackofficeLayout';
import { Login } from './pages/Login';
import { CommandCenter } from './pages/CommandCenter';
import { ComingSoon } from './pages/ComingSoon';

const COMING_SOON_ROUTES: { path: string; title: string }[] = [
  { path: '/hr', title: 'HR & People' },
  { path: '/hr/employees/:id', title: 'Employee Detail' },
  { path: '/attendance', title: 'Attendance Overview' },
  { path: '/attendance/import', title: 'Fingerprint Import' },
  { path: '/attendance/exceptions', title: 'Exception Review' },
  { path: '/payroll', title: 'Payroll Overview' },
  { path: '/payroll/regular', title: 'Regular Payroll' },
  { path: '/payroll/barber', title: 'Barber Payroll' },
  { path: '/payroll/employee/:id', title: 'Payroll Employee Detail' },
  { path: '/operations', title: 'Operations' },
  { path: '/crm', title: 'CRM Overview' },
  { path: '/crm/customers/:id', title: 'Customer 360' },
  { path: '/membership', title: 'Membership Report' },
  { path: '/stockist', title: 'Stockist & Inventory Dashboard' },
  { path: '/moka', title: 'Moka POS Integration' },
  { path: '/reports', title: 'Reports Overview' },
  { path: '/reports/branches', title: 'Branch Performance' },
  { path: '/reports/customers', title: 'Customer Report' },
  { path: '/reports/barbers', title: 'Barber Performance' },
  { path: '/system/roles', title: 'Peran & Izin' },
  { path: '/system/packages', title: 'Akses Paket' },
  { path: '/system/settings', title: 'Pengaturan' },
];

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <BackofficeLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<CommandCenter />} />
          {COMING_SOON_ROUTES.map((route) => (
            <Route key={route.path} path={route.path} element={<ComingSoon title={route.title} />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

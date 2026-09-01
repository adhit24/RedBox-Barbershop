import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { BackofficeLayout } from './layouts/BackofficeLayout';
import { Login } from './pages/Login';
import { CommandCenter } from './pages/CommandCenter';
import { Operations } from './pages/Operations';
import { CRMOverview } from './pages/CRMOverview';
import { Customer360 } from './pages/Customer360';
import { CustomerReport } from './pages/CustomerReport';
import { MembershipReport } from './pages/MembershipReport';
import { ReportsOverview } from './pages/ReportsOverview';
import { BranchPerformance } from './pages/BranchPerformance';
import { BarberPerformance } from './pages/BarberPerformance';
import { MokaIntegration } from './pages/MokaIntegration';
import { ComingSoon } from './pages/ComingSoon';
import { COMMAND_CENTER_PATH, LOGIN_PATH, PLACEHOLDER_ROUTES } from './routes';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path={LOGIN_PATH} element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <BackofficeLayout />
            </ProtectedRoute>
          }
        >
          <Route path={COMMAND_CENTER_PATH} element={<CommandCenter />} />
          <Route path="/operations" element={<Operations />} />
          <Route path="/crm" element={<CRMOverview />} />
          <Route path="/crm/customers/:id" element={<Customer360 />} />
          <Route path="/reports/customers" element={<CustomerReport />} />
          <Route path="/reports/membership" element={<MembershipReport />} />
          <Route path="/reports" element={<ReportsOverview />} />
          <Route path="/reports/branches" element={<BranchPerformance />} />
          <Route path="/reports/barbers" element={<BarberPerformance />} />
          <Route path="/moka" element={<MokaIntegration />} />
          {PLACEHOLDER_ROUTES.map((route) => (
            <Route key={route.path} path={route.path} element={<ComingSoon title={route.title} />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to={COMMAND_CENTER_PATH} replace />} />
      </Routes>
    </AuthProvider>
  );
}

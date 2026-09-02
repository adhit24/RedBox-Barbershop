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
import { BookingPerformance } from './pages/BookingPerformance';
import { AttendanceReport } from './pages/AttendanceReport';
import { InventoryReport } from './pages/InventoryReport';
import { MokaIntegration } from './pages/MokaIntegration';
import { StockistDashboard } from './pages/StockistDashboard';
import { HREmployeeList } from './pages/HREmployeeList';
import { EmployeeDetail } from './pages/EmployeeDetail';
import { AttendanceOverview } from './pages/AttendanceOverview';
import { FingerprintImport } from './pages/FingerprintImport';
import { ExceptionReview } from './pages/ExceptionReview';
import { PayrollOverview } from './pages/PayrollOverview';
import { RegularPayroll } from './pages/RegularPayroll';
import { BarberPayroll } from './pages/BarberPayroll';
import { PayrollEmployeeDetail } from './pages/PayrollEmployeeDetail';
import { RolesPermissions } from './pages/RolesPermissions';
import { PackageFeatureAccess } from './pages/PackageFeatureAccess';
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
          <Route path="/reports/bookings" element={<BookingPerformance />} />
          <Route path="/reports/attendance" element={<AttendanceReport />} />
          <Route path="/reports/inventory" element={<InventoryReport />} />
          <Route path="/moka" element={<MokaIntegration />} />
          <Route path="/stockist" element={<StockistDashboard />} />
          <Route path="/hr" element={<HREmployeeList />} />
          <Route path="/hr/employees/:id" element={<EmployeeDetail />} />
          <Route path="/attendance" element={<AttendanceOverview />} />
          <Route path="/attendance/import" element={<FingerprintImport />} />
          <Route path="/attendance/exceptions" element={<ExceptionReview />} />
          <Route path="/payroll" element={<PayrollOverview />} />
          <Route path="/payroll/regular" element={<RegularPayroll />} />
          <Route path="/payroll/barber" element={<BarberPayroll />} />
          <Route path="/payroll/employees/:id" element={<PayrollEmployeeDetail />} />
          <Route path="/system/roles" element={<RolesPermissions />} />
          <Route path="/system/packages" element={<PackageFeatureAccess />} />
          {PLACEHOLDER_ROUTES.map((route) => (
            <Route key={route.path} path={route.path} element={<ComingSoon title={route.title} />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to={COMMAND_CENTER_PATH} replace />} />
      </Routes>
    </AuthProvider>
  );
}

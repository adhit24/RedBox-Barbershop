import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { BackofficeLayout } from './layouts/BackofficeLayout';
import { Login } from './pages/Login';
import { CommandCenter } from './pages/CommandCenter';
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
          {PLACEHOLDER_ROUTES.map((route) => (
            <Route key={route.path} path={route.path} element={<ComingSoon title={route.title} />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to={COMMAND_CENTER_PATH} replace />} />
      </Routes>
    </AuthProvider>
  );
}

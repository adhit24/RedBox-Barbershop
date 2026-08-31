import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { LoadingState } from '../components/LoadingState';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingState label="Memeriksa sesi..." />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';

export default function StockistIndexPage() {
  const { user, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    router.replace(user.role === 'owner' ? '/admin/stockist/warehouse' : '/admin/stockist/branch-stock');
  }, [user, loading, router]);

  return null;
}

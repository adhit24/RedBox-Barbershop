'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';

export default function StockistLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user || !['owner', 'branch_admin'].includes(user.role)) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) return null;

  return (
    <div className="min-h-dvh pb-20" style={{ background: '#070508', color: '#F0EAEB' }}>
      <header
        className="backdrop-blur-md border-b px-4 py-2.5"
        style={{ background: 'rgba(8,5,9,0.96)', borderColor: '#201618' }}
      >
        <h1 className="font-bold text-[13px] tracking-widest uppercase" style={{ color: '#F0EAEB' }}>
          RedBox Stockist
        </h1>
        {user.role === 'branch_admin' && (
          <p className="text-[10px] capitalize font-medium" style={{ color: '#C72820' }}>{user.branch}</p>
        )}
      </header>
      <main className="px-4 py-4">{children}</main>
    </div>
  );
}

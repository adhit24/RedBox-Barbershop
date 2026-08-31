import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';

export function BackofficeLayout() {
  return (
    <div className="flex min-h-screen bg-rb-bg">
      <Sidebar />
      <main className="flex-1 overflow-y-auto px-9 pt-7 pb-12">
        <div className="mx-auto w-full max-w-[1360px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

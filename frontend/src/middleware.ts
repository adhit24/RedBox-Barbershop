import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — no auth needed
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/barber/login') ||
    pathname.startsWith('/signage') ||
    pathname.startsWith('/ai-hairstyle') ||
    pathname.startsWith('/api/ai-hairstyle') ||
    pathname.startsWith('/api/barber/auth/') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|js|json|css|woff|woff2)$/)
  ) {
    return NextResponse.next();
  }

  // Barber session cookie → allow /barber/* and /api/barber/*
  const barberSession = request.cookies.get('redbox_barber_session')?.value;
  if (barberSession) {
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/barber/home', request.url));
    }
    if (pathname.startsWith('/barber/') || pathname.startsWith('/api/barber/')) {
      return NextResponse.next();
    }
    if (pathname.startsWith('/admin/')) {
      return NextResponse.redirect(new URL('/barber/home', request.url));
    }
  }

  if (pathname.startsWith('/barber/') && !pathname.startsWith('/barber/login')) {
    return NextResponse.redirect(new URL('/barber/login', request.url));
  }

  if (!supabaseUrl || !supabaseKey) return NextResponse.next();

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // getSession() can trigger a token-refresh network call to Supabase auth servers.
  // Without a timeout this hangs indefinitely on slow/failed refreshes — cap at 4s.
  let user: { id: string } | null = null;
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<{ data: { session: null } }>((resolve) =>
        setTimeout(() => resolve({ data: { session: null } }), 4000)
      ),
    ]);
    user = result.data.session?.user ?? null;
  } catch {
    user = null;
  }

  if (!user) {
    if (pathname === '/') return response;
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Authenticated user at '/' → redirect to dashboard.
  // Barbers are already caught above by the cookie check.
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/admin/dashboard', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons).*)', '/'],
};

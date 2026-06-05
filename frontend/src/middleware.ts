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

  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (pathname === '/') {
    const { data: profile } = await supabase
      .from('users').select('role').eq('id', user.id).single();
    const dest = profile?.role === 'barber' ? '/barber/home' : '/admin/dashboard';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons).*)', '/'],
};

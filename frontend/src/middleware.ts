import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// stockist.redboxbarbershop.com is a standalone domain for the stockist app,
// which physically lives under /admin/stockist/*. Requests on this host are
// transparently rewritten so the browser never shows the /admin/stockist
// prefix — the app behaves like it has its own root.
const STOCKIST_HOST = 'stockist.redboxbarbershop.com';

async function getAuthenticatedUser(request: NextRequest): Promise<{ id: string } | null> {
  if (!supabaseUrl || !supabaseKey) return null;
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: () => {},
    },
  });
  try {
    // getSession() can trigger a token-refresh network call to Supabase auth
    // servers. Without a timeout this hangs indefinitely on slow/failed
    // refreshes — cap at 4s.
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<{ data: { session: null } }>((resolve) =>
        setTimeout(() => resolve({ data: { session: null } }), 4000)
      ),
    ]);
    return result.data.session?.user ?? null;
  } catch {
    return null;
  }
}

async function handleStockistDomain(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|js|json|css|woff|woff2)$/)) {
    return NextResponse.next();
  }

  // Existing pages still navigate internally with hardcoded /admin/stockist/*
  // absolute paths (router.push, <Link href>, etc.) — untouched, to avoid a
  // wide refactor. Redirect those to the clean equivalent so the address bar
  // never shows the prefix, then let the redirected request fall through to
  // the rewrite logic below.
  if (pathname.startsWith('/admin/stockist')) {
    const clean = request.nextUrl.clone();
    clean.pathname = pathname.replace(/^\/admin\/stockist/, '') || '/';
    return NextResponse.redirect(clean, 308);
  }

  const isLoginPath = pathname === '/login';
  if (!isLoginPath) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = isLoginPath ? '/admin/stockist/login' : `/admin/stockist${pathname === '/' ? '' : pathname}`;
  return NextResponse.rewrite(rewriteUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // request.nextUrl.hostname is unreliable for this — depending on how the
  // request reaches Next.js (local dev, behind Vercel's proxy) it can
  // reflect the bound address instead of the actual incoming Host header.
  // The Host header itself is the one value that's always correct.
  const requestHost = (request.headers.get('host') || '').split(':')[0];

  // Checked before the generic public-routes passthrough below, since that
  // block's pathname.startsWith('/login') would otherwise swallow this
  // host's /login request and serve the wrong (main Staff Portal) page.
  if (requestHost === STOCKIST_HOST && !pathname.startsWith('/api/')) {
    return handleStockistDomain(request);
  }

  // Public routes — no auth needed
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/barber/login') ||
    pathname.startsWith('/admin/stockist/login') ||
    pathname.startsWith('/signage') ||
    pathname.startsWith('/ai-hairstyle') ||
    pathname.startsWith('/api/ai-hairstyle') ||
    pathname.startsWith('/api/barber/auth/') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|js|json|css|woff|woff2)$/)
  ) {
    return NextResponse.next();
  }

  // Barber session cookie → only allow /barber/* and /api/barber/*
  const barberSession = request.cookies.get('redbox_barber_session')?.value;
  if (barberSession) {
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/barber/home', request.url));
    }
    if (pathname.startsWith('/barber/') || pathname.startsWith('/api/barber/')) {
      return NextResponse.next();
    }
    // Kapster tidak bisa akses admin atau owner area
    if (pathname.startsWith('/admin/') || pathname.startsWith('/owner/')) {
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
    if (pathname.startsWith('/admin/stockist')) {
      return NextResponse.redirect(new URL('/admin/stockist/login', request.url));
    }
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

import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — no auth needed
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/ai-hairstyle') ||
    pathname.startsWith('/api/ai-hairstyle') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|js|json|css|woff|woff2)$/)
  ) {
    return NextResponse.next();
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

  const { data: { user } } = await supabase.auth.getUser();

  // Not logged in → redirect to /login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Root / → redirect based on role
  if (pathname === '/') {
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    const dest = profile?.role === 'barber' ? '/barber/schedule' : '/admin/dashboard';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons).*)', '/'],
};

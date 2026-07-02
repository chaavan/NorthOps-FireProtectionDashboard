import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { apiRateLimiter, authRateLimiter, writeRateLimiter, getClientIdentifier } from '@/lib/rateLimit';
import { softwareConfig } from '@/lib/softwareConfig';

// Rate limiting configuration per route
const rateLimitConfig: Record<string, { limiter: typeof apiRateLimiter; path: string }> = {
  '/api/auth': { limiter: authRateLimiter, path: '/api/auth' },
  '/api/jobs/update': { limiter: writeRateLimiter, path: '/api/jobs/update' },
  '/api/jobs/add-line': { limiter: writeRateLimiter, path: '/api/jobs/add-line' },
  '/api/delivery/update': { limiter: writeRateLimiter, path: '/api/delivery/update' },
  '/api/users': { limiter: writeRateLimiter, path: '/api/users' },
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (/\.(?:png|jpe?g|gif|svg|webp|ico|woff2?)$/i.test(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request });
  const identifier = token?.sub ? `user:${token.sub}` : getClientIdentifier(request);

  // Apply rate limiting to API routes
  if (pathname.startsWith('/api/')) {
    // Skip rate limiting for auth callback endpoints
    if (pathname.startsWith('/api/auth/')) {
      // Only rate limit non-callback auth endpoints
      if (!pathname.includes('/callback') && !pathname.includes('/signin')) {
        const result = authRateLimiter.check(identifier);
        
        if (!result.allowed) {
          return NextResponse.json(
            { 
              error: 'Too many requests', 
              message: 'Rate limit exceeded. Please try again later.',
              retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
            },
            { 
              status: 429,
              headers: {
                'X-RateLimit-Limit': '60',
                'X-RateLimit-Remaining': result.remaining.toString(),
                'X-RateLimit-Reset': result.resetTime.toString(),
                'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
              },
            }
          );
        }
      }
    } else {
      // Apply appropriate rate limiter based on route
      let limiter = apiRateLimiter;
      for (const [prefix, config] of Object.entries(rateLimitConfig)) {
        if (pathname.startsWith(config.path)) {
          limiter = config.limiter;
          break;
        }
      }

      const result = limiter.check(identifier);
      
      if (!result.allowed) {
        const limit = limiter === writeRateLimiter ? '120' : limiter === authRateLimiter ? '60' : '300';
        return NextResponse.json(
          { 
            error: 'Too many requests', 
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
          },
          { 
            status: 429,
            headers: {
              'X-RateLimit-Limit': limit,
              'X-RateLimit-Remaining': result.remaining.toString(),
              'X-RateLimit-Reset': result.resetTime.toString(),
              'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
            },
          }
        );
      }
    }
  }

  // Apply NextAuth session checks for protected routes
  const isAuthRoute = pathname.startsWith('/api/auth');
  const portalEnabled = softwareConfig.portalEnabled;
  const locationSelectEnabled = softwareConfig.locationSelectEnabled;

  if (pathname.startsWith('/select') && !locationSelectEnabled) {
    const loginUrl = new URL('/login', request.url);
    request.nextUrl.searchParams.forEach((value, key) => {
      loginUrl.searchParams.set(key, value);
    });
    return NextResponse.redirect(loginUrl);
  }

  const isPublicRoute = pathname.startsWith('/login') ||
                        (locationSelectEnabled && pathname.startsWith('/select')) ||
                        pathname.startsWith('/auth') ||
                        pathname.startsWith('/api/auth') ||
                        pathname.startsWith('/_next') ||
                        pathname === '/favicon.ico' ||
                        pathname === '/icon.png' ||
                        (portalEnabled && pathname === '/');

  // For API routes that require auth (except auth routes themselves)
  if (pathname.startsWith('/api/') && !isAuthRoute && !isPublicRoute) {
    // Most API routes require authentication - individual routes will handle 401
    // We don't block here, let the route handlers check auth
  }

  // For page routes, redirect to login if not authenticated
  if (!isPublicRoute && !isAuthRoute && !token && !pathname.startsWith('/_next') && !pathname.startsWith('/api/')) {
    const callbackUrl = `${request.nextUrl.pathname}${request.nextUrl.search}`;

    if (portalEnabled) {
      const portalUrl = new URL('/', request.url);
      portalUrl.searchParams.set('callbackUrl', callbackUrl);
      return NextResponse.redirect(portalUrl);
    }

    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - icon.png (app icon)
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.png|northops-logo.png|northops-icon.png|estimate-logo.png).*)',
  ],
}

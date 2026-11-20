import { analyticsAuthorized } from "./lib/analytics-auth";
import { NextResponse, type NextRequest } from "next/server";
import { essentialsPath, essentialsSlug, LANG_COOKIE, localize, preferredLocale, localeFromPath, routeAlias, stripLocale } from "./lib/locale";

const essentialsPages = new Set(Object.values(essentialsSlug));

function internalPath(pathname: string): string {
  const bare = stripLocale(pathname);
  const slug = bare.replace(/^\//, "");
  if (essentialsPages.has(slug)) return "/essentials";
  return bare;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const prefixed = localeFromPath(pathname);
  if (stripLocale(pathname).replace(/\/$/, "") === "/analytics" && !analyticsAuthorized(request.headers.get("authorization"))) {
    return new NextResponse("Acesso reservado ao administrador.", { status: 401, headers: {
      "WWW-Authenticate": 'Basic realm="maio.cv Analytics", charset="UTF-8"',
      "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
    } });
  }

  if (prefixed) {
    const slug = stripLocale(pathname).replace(/^\/|\/$/g, "");
    if (slug === "mcp") {
      const to = request.nextUrl.clone();
      to.pathname = localize(prefixed, "/faq");
      return NextResponse.redirect(to, 308);
    }
    const target = routeAlias[slug] ?? (essentialsPages.has(slug) && slug !== essentialsSlug[prefixed] ? "essentials" : null);
    if (target) {
      const to = request.nextUrl.clone();
      to.pathname = target === "essentials" ? essentialsPath(prefixed) : localize(prefixed, "/search");
      return NextResponse.redirect(to, 308);
    }
    const url = request.nextUrl.clone();
    url.pathname = internalPath(pathname);
    const headers = new Headers(request.headers);
    headers.set("x-maio-lang", prefixed);
    headers.set("x-maio-path", `${pathname}${request.nextUrl.search}`);
    const response = NextResponse.rewrite(url, { request: { headers } });
    response.cookies.set(LANG_COOKIE, prefixed, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return response;
  }

  // Bare short share link: the page picks the trip's language, so skip the default-locale redirect.
  if (/^\/t\/[0-9A-Za-z]{6,8}\/?$/.test(pathname)) return NextResponse.next();

  const destination = request.nextUrl.clone();
  // An English browser lands on /en, not the Portuguese default; a language the guest picked before still wins.
  const locale = preferredLocale(request.cookies.get(LANG_COOKIE)?.value, request.headers.get("accept-language"));
  destination.pathname = pathname === "/" ? localize(locale, "/") : localize(locale, pathname);
  const response = NextResponse.redirect(destination, 307);
  response.headers.set("Vary", "Accept-Language, Cookie");
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};

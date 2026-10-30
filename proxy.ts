import { NextResponse, type NextRequest } from "next/server";
import { essentialsPath, essentialsSlug, LANG_COOKIE, DEFAULT_LOCALE, localize, localeFromPath, routeAlias, stripLocale } from "./lib/locale";

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

  const destination = request.nextUrl.clone();
  const locale = DEFAULT_LOCALE;
  destination.pathname = pathname === "/" ? localize(locale, "/") : localize(locale, pathname);
  const response = NextResponse.redirect(destination, 307);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};

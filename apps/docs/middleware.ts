import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Redirect /docs/en/* to /[locale]/docs/* for English
  // This must run BEFORE the catch-all route catches /docs/en
  if (pathname.startsWith("/docs/en")) {
    const newPath = pathname.replace("/docs/en", "/en/docs");
    return NextResponse.redirect(new URL(newPath, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

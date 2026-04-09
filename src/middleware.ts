import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const rol = (req.auth?.user as any)?.rol;

  const isAuthPage = nextUrl.pathname.startsWith("/login");
  const isApiRoute = nextUrl.pathname.startsWith("/api");
  const isPublic = nextUrl.pathname === "/";

  if (isApiRoute) return NextResponse.next();

  if (!isLoggedIn && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  if (isLoggedIn && isAuthPage) {
    if (rol === "SUPERADMIN") return NextResponse.redirect(new URL("/admin", nextUrl));
    if (rol === "MANAGER") return NextResponse.redirect(new URL("/manager", nextUrl));
    return NextResponse.redirect(new URL("/empleado", nextUrl));
  }

  if (isLoggedIn) {
    const path = nextUrl.pathname;
    if (path.startsWith("/admin") && rol !== "SUPERADMIN") {
      return NextResponse.redirect(new URL("/empleado", nextUrl));
    }
    if (path.startsWith("/manager") && rol !== "MANAGER" && rol !== "SUPERADMIN") {
      return NextResponse.redirect(new URL("/empleado", nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|.*\\.png$).*)"],
};

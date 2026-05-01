/**
 * POST /api/admin/logout — clear cookie + audit.
 */

import { NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";
import { writeAuditEntry, extractRequestMeta } from "@/lib/admin/audit";
import { ADMIN_COOKIE_NAME } from "@/lib/admin/jwt";

export const POST = withSuperAdmin(async (req) => {
  const sa = currentSuperAdmin();
  const meta = extractRequestMeta(req.headers);
  await writeAuditEntry({
    superAdminId: sa.id,
    action: "super-admin:logout",
    targetKind: "session",
    targetId: sa.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  const res = NextResponse.json({ success: true });
  res.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
});

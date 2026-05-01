/**
 * GET /api/admin/me — info del super-admin actual.
 */

import { NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/admin/with-super-admin";
import { currentSuperAdmin } from "@/lib/admin/context";

export const GET = withSuperAdmin(async () => {
  const sa = currentSuperAdmin();
  return NextResponse.json({ id: sa.id, email: sa.email, role: sa.role });
});

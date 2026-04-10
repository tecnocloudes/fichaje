import { Resend } from "resend";
import { prisma } from "./prisma";

export async function sendEmail(to: string, subject: string, html: string) {
  const config = await prisma.configuracionEmpresa.findFirst({
    select: { emailActivo: true, emailPassword: true, emailFrom: true },
  });

  if (!config?.emailActivo || !config?.emailPassword) return;

  const resend = new Resend(config.emailPassword);
  await resend.emails.send({
    from: config.emailFrom || "noreply@resend.dev",
    to,
    subject,
    html,
  });
}

import nodemailer from "nodemailer";
import { prisma } from "./prisma";

export async function sendEmail(to: string, subject: string, html: string) {
  const config = await prisma.configuracionEmpresa.findFirst();
  if (!config?.emailActivo || !config?.emailHost) return;

  const transporter = nodemailer.createTransport({
    host: config.emailHost,
    port: config.emailPort ?? 587,
    secure: config.emailSecure,
    auth: config.emailUser
      ? { user: config.emailUser, pass: config.emailPassword ?? "" }
      : undefined,
  });

  await transporter.sendMail({
    from: config.emailFrom || config.emailUser || "noreply@empresa.com",
    to,
    subject,
    html,
  });
}

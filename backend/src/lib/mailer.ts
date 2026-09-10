import nodemailer, { type Transporter } from "nodemailer";
import { env, smtpConfigured } from "./env.js";
import { logger } from "./logger.js";

let transporter: Transporter | null = null;

if (smtpConfigured) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  });
} else {
  logger.warn(
    "[mailer] SMTP_USER / SMTP_PASS not set — the Email+OTP sign-in path will 503 until SMTP is configured."
  );
}

export const isMailerConfigured = () => smtpConfigured;

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (!transporter) {
    throw new Error("Mailer is not configured");
  }

  await transporter.sendMail({
    from: `ZATLAN <${env.SMTP_USER}>`,
    to,
    subject: `${code} is your ZATLAN verification code`,
    text: `Your ZATLAN verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your ZATLAN verification code is <strong style="font-size:20px; letter-spacing:2px;">${code}</strong>.</p><p>It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`
  });
}

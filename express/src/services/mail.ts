import nodemailer from "nodemailer";
import { config } from "../config.js";

/**
 * ส่งอีเมลด้วยค่า MAIL_* ชุดเดียวกับ Laravel
 * MAIL_MAILER=log → เขียนลง console (ยังไม่ส่งจริง), smtp → ส่งผ่าน SMTP (MAIL_SCHEME=smtps หรือพอร์ต 465 = TLS ตั้งแต่ต้น)
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** ใช้ในเทสต์เพื่อตรวจอีเมลที่ถูกส่ง (แทน Notification::fake) */
export const sentMail: MailMessage[] = [];

let transport: nodemailer.Transporter | null = null;

export async function sendMail(msg: MailMessage): Promise<void> {
  if (process.env.NODE_ENV === "test" || config.mail.mailer === "array") {
    sentMail.push(msg);
    return;
  }
  if (config.mail.mailer !== "smtp") {
    console.info(`[mail:${config.mail.mailer}] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
    return;
  }
  transport ??= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.scheme === "smtps" || config.mail.port === 465,
    auth: config.mail.username ? { user: config.mail.username, pass: config.mail.password } : undefined,
  });
  await transport.sendMail({
    from: { name: config.mail.fromName, address: config.mail.fromAddress },
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

import { z } from "zod";
import { Email } from "@/lib/schemas/common";

// Mirrors supabase/config.toml: minimum_password_length = 8, password_requirements = letters_digits.
// 72 bytes is bcrypt's limit; longer passwords would be silently truncated.
export const Password = z
  .string()
  .min(8, { message: "Use at least 8 characters." })
  .max(72, { message: "Use at most 72 characters." })
  .regex(/[A-Za-z]/, { message: "Include at least one letter." })
  .regex(/[0-9]/, { message: "Include at least one number." });

export const SignInInput = z.object({
  email: Email,
  password: z.string().min(1, { message: "Enter your password." }).max(72),
  next: z.string().optional(),
});

export const SignUpInput = z
  .object({
    email: Email,
    password: Password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match.",
  });

export const ResendInput = z.object({ email: Email });

export const ForgotPasswordInput = z.object({ email: Email });

export const ResetPasswordInput = z
  .object({ password: Password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match.",
  });

export const EmailOtpType = z.enum([
  "email",
  "signup",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
]);

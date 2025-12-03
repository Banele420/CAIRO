import { z } from 'zod';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  
  // Database
  DATABASE_URL: z.string().url(),
  
  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  
  // OAuth
  MANUS_CLIENT_ID: z.string().optional(),
  MANUS_CLIENT_SECRET: z.string().optional(),
  MANUS_REDIRECT_URI: z.string().url().optional(),
  
  // Paystack
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  
  // Email (for OTP)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  
  // Redis (for rate limiting)
  UPSTASH_REDIS_URL: z.string().url().optional(),
  UPSTASH_REDIS_TOKEN: z.string().optional(),
  
  // Google Maps
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  
  // File storage
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  
  // Analytics
  PLAUSIBLE_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
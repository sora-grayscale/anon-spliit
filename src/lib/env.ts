import { ZodIssueCode, z } from 'zod'

const interpretEnvVarAsBool = (val: unknown): boolean => {
  if (typeof val !== 'string') return false
  return ['true', 'yes', '1', 'on'].includes(val.toLowerCase())
}

// Convert empty strings to undefined for optional fields
const emptyStringToUndefined = (val: unknown): unknown => {
  if (typeof val === 'string' && val.trim() === '') return undefined
  return val
}

const envSchema = z
  .object({
    POSTGRES_URL_NON_POOLING: z.string().url(),
    POSTGRES_PRISMA_URL: z.string().url(),
    // Auto-delete settings (Issue #10)
    AUTO_DELETE_INACTIVE_DAYS: z.coerce.number().int().min(0).default(90),
    DELETE_GRACE_PERIOD_DAYS: z.coerce.number().int().min(1).default(7),
    CRON_SECRET: z.preprocess(emptyStringToUndefined, z.string().optional()),
    // Private Instance Mode (Issue #4)
    PRIVATE_INSTANCE: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    ADMIN_EMAIL: z.preprocess(
      emptyStringToUndefined,
      z.string().email().optional(),
    ),
    ADMIN_PASSWORD: z.preprocess(emptyStringToUndefined, z.string().optional()),
    NEXTAUTH_SECRET: z.preprocess(
      emptyStringToUndefined,
      z.string().optional(),
    ),
    NEXTAUTH_URL: z.preprocess(
      emptyStringToUndefined,
      z.string().url().optional(),
    ),
    NEXT_PUBLIC_BASE_URL: z
      .string()
      .optional()
      .default(
        process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000',
      ),
    NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    NEXT_PUBLIC_DEFAULT_CURRENCY_CODE: z.preprocess(
      emptyStringToUndefined,
      z.string().optional(),
    ),
    S3_UPLOAD_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
    S3_UPLOAD_SECRET: z.preprocess(
      emptyStringToUndefined,
      z.string().optional(),
    ),
    S3_UPLOAD_BUCKET: z.preprocess(
      emptyStringToUndefined,
      z.string().optional(),
    ),
    S3_UPLOAD_REGION: z.preprocess(
      emptyStringToUndefined,
      z.string().optional(),
    ),
    S3_UPLOAD_ENDPOINT: z.preprocess(
      emptyStringToUndefined,
      z.string().optional(),
    ),
    NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    OPENAI_API_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
    // Two-Factor Authentication (2FA)
    TWO_FA_ENCRYPTION_KEY: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .length(
          64,
          'TWO_FA_ENCRYPTION_KEY must be exactly 64 hex characters (256 bits)',
        )
        .regex(/^[0-9a-fA-F]+$/, 'TWO_FA_ENCRYPTION_KEY must be a hex string')
        .optional(),
    ),
    // TOTP Algorithm (Issue #49) - SHA1 for compatibility, SHA256 for better security
    TOTP_ALGORITHM: z
      .enum(['SHA1', 'SHA256'])
      .default('SHA1')
      .describe(
        'TOTP hash algorithm (SHA1 for compatibility, SHA256 for security)',
      ),
  })
  .superRefine((env, ctx) => {
    if (
      env.NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS &&
      // S3_UPLOAD_ENDPOINT is fully optional as it will only be used for providers other than AWS
      (!env.S3_UPLOAD_BUCKET ||
        !env.S3_UPLOAD_KEY ||
        !env.S3_UPLOAD_REGION ||
        !env.S3_UPLOAD_SECRET)
    ) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'If NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS is specified, then S3_* must be specified too',
      })
    }
    if (
      (env.NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT ||
        env.NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT) &&
      !env.OPENAI_API_KEY
    ) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'If NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT or NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT is specified, then OPENAI_API_KEY must be specified too',
      })
    }
    // NEXTAUTH_SECRET is required for Private Instance Mode
    if (env.PRIVATE_INSTANCE && !env.NEXTAUTH_SECRET) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'NEXTAUTH_SECRET must be set when PRIVATE_INSTANCE is enabled for secure JWT signing',
      })
    }
    // ADMIN_EMAIL and ADMIN_PASSWORD are required for Private Instance Mode
    if (env.PRIVATE_INSTANCE && (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD)) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'ADMIN_EMAIL and ADMIN_PASSWORD must be set when PRIVATE_INSTANCE is enabled',
      })
    }
  })

function parseEnv() {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    console.error(
      '\n❌ Environment variable validation failed:\n' + errorMessages + '\n',
    )
    throw new Error('Invalid environment variables. Check console for details.')
  }
  return result.data
}

export const env = parseEnv()

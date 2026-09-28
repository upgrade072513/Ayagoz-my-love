export const ENV = {
  sessionSecret: process.env.SESSION_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  fileEncryptionKey:
    process.env.FILE_ENCRYPTION_KEY ??
    process.env.CONTRACT_FILE_ENCRYPTION_KEY ??
    "",
  scheduledSecret: process.env.SCHEDULED_HEARTBEAT_SECRET ?? "",
};

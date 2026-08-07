type AdminSessionProxyEnvironment = Readonly<Record<string, string | undefined>>;

export function requireAdminSessionProxySecret(
  env: AdminSessionProxyEnvironment = process.env,
): string {
  const proxySecret = env.ADMIN_SESSION_PROXY_SECRET?.trim() ?? '';
  const adminPassword = env.ADMIN_PASSWORD?.trim() ?? '';

  if (!proxySecret || (adminPassword && proxySecret === adminPassword)) {
    throw new Error('membership admin proxy is not configured securely');
  }

  return proxySecret;
}

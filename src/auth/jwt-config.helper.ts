import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';

/** Même secret pour JwtModule (sign) et JwtStrategy (verify). */
export function getJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (secret && secret.trim().length > 0) {
    return secret.trim();
  }
  return 'your_secret_key';
}

/**
 * Durée de vie du token — lue depuis JWT_EXPIRES_IN (.env).
 * Ex. 3600s, 1h, 7d. Défaut 7d en dev pour limiter les 401 « token expiré ».
 */
export function getJwtExpiresIn(config: ConfigService): StringValue {
  const raw = config.get<string>('JWT_EXPIRES_IN');
  if (raw != null && raw.trim().length > 0) {
    return raw.trim() as StringValue;
  }
  return (process.env.NODE_ENV === 'production' ? '1h' : '7d') as StringValue;
}

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/**
 * Simple in-memory rate limiter for password reset endpoints
 * 
 * PRODUCTION RECOMMENDATIONS:
 * - Use Redis for distributed rate limiting
 * - Use @nestjs/throttler package
 * - Implement IP-based + email-based rate limiting
 * - Add CAPTCHA after N failed attempts
 * 
 * Current limits:
 * - 3 requests per email per 15 minutes
 * - 10 requests per IP per 15 minutes
 */
@Injectable()
export class PasswordResetRateLimitGuard implements CanActivate {
  private readonly requests = new Map<string, number[]>();
  private readonly EMAIL_LIMIT = 3; // requests per window
  private readonly IP_LIMIT = 10;
  private readonly WINDOW_MS = 15 * 60 * 1000; // 15 minutes

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const email = request.body?.email;
    const ip = request.ip || request.connection.remoteAddress;

    // Check email-based rate limit
    if (email && this.isRateLimited(`email:${email}`, this.EMAIL_LIMIT)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many password reset requests. Please try again later.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Check IP-based rate limit
    if (ip && this.isRateLimited(`ip:${ip}`, this.IP_LIMIT)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests from this IP. Please try again later.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Track request
    if (email) this.trackRequest(`email:${email}`);
    if (ip) this.trackRequest(`ip:${ip}`);

    return true;
  }

  private isRateLimited(key: string, limit: number): boolean {
    const now = Date.now();
    const requests = this.requests.get(key) || [];
    
    // Remove old requests outside the window
    const recentRequests = requests.filter(
      (timestamp) => now - timestamp < this.WINDOW_MS,
    );
    
    return recentRequests.length >= limit;
  }

  private trackRequest(key: string): void {
    const now = Date.now();
    const requests = this.requests.get(key) || [];
    
    // Remove old requests and add new one
    const recentRequests = requests.filter(
      (timestamp) => now - timestamp < this.WINDOW_MS,
    );
    recentRequests.push(now);
    
    this.requests.set(key, recentRequests);

    // Cleanup old entries (run occasionally)
    if (Math.random() < 0.01) {
      this.cleanup();
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, requests] of this.requests.entries()) {
      const recent = requests.filter(
        (timestamp) => now - timestamp < this.WINDOW_MS,
      );
      if (recent.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, recent);
      }
    }
  }
}

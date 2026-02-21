# Password Reset Implementation Documentation

## 📋 Overview

Production-ready password reset flow using **custom tokens** with email delivery for NestJS backend with `public.users` table. This implementation uses:

- **Custom reset tokens** (stored in `password_reset_tokens` table)
- **Email delivery** via Nodemailer (SMTP)
- **Token hashing** with SHA-256 for security
- **Rate limiting** to prevent abuse
- **Deep link support** for Flutter mobile app

---

## 🏗️ Architecture

### File Structure
```
footsmart-backend/src/
├── auth/
│   ├── auth.module.ts                    # Module configuration
│   ├── auth.controller.ts                # Password reset endpoints
│   ├── auth.service.ts                   # Business logic with token hashing
│   ├── dto/
│   │   ├── forgot-password.dto.ts        # Email validation
│   │   └── reset-password.dto.ts         # Token + password validation
│   ├── entities/
│   │   └── password-reset-token.entity.ts # Token storage schema
│   ├── guards/
│   │   └── password-reset-rate-limit.guard.ts # Rate limiting
│   └── services/
│       └── email.service.ts              # Email sending with templates
└── config/
    └── supabase.config.ts                # Supabase client (optional)
```

### Database Schema

**Table:** `password_reset_tokens`
```sql
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,  -- SHA-256 hashed token
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_password_reset_token ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_user_id ON password_reset_tokens(user_id);
```

---

## 🔐 Security Features

### 1. Token Hashing
- **Generation:** 32 bytes random (256 bits) → 64 hex characters
- **Storage:** SHA-256 hash of token (never store raw token)
- **Transmission:** Raw token sent via email only

```typescript
// Generate: randomBytes(32).toString('hex')
Raw Token:  "abc123def456..."  (sent in email)
Stored Hash: "3a7bd3e2990af0b07b8f7e6c1234567..." (in database)
```

### 2. Rate Limiting
- **Per Email:** 3 requests / 15 minutes
- **Per IP:** 10 requests / 15 minutes
- **Status Code:** 429 Too Many Requests

**Production Recommendation:** Use Redis-based rate limiting with `@nestjs/throttler`

### 3. Email Enumeration Prevention
- Always return success message regardless of email existence
- No distinction between "user found" vs "user not found"
- Consistent response time

### 4. Token Properties
- **One-time use** (marked as `used` after password reset)
- **1-hour expiration** (configurable)
- **Automatic cleanup** of old tokens per user
- **Cryptographically secure** random generation

---

## 🚀 Setup & Installation

### 1. Install Dependencies
```bash
cd footsmart-backend
npm install nodemailer @types/nodemailer
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and configure:

```bash
# Email Configuration (Gmail Example)
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password  # Generate from Google Account settings
SMTP_FROM_EMAIL=noreply@footsmartpro.com

# Password Reset
RESET_REDIRECT_URL=myapp://reset-password  # Flutter deep link
APP_NAME=FootSmart Pro

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=footsmart
```

### 3. Gmail App Password Setup
If using Gmail:
1. Enable 2-Factor Authentication on your Google account
2. Go to: https://myaccount.google.com/apppasswords
3. Generate an "App Password"
4. Use this password in `SMTP_PASS`

### 4. Run Migrations
Ensure `password_reset_tokens` table exists:
```bash
npm run build
npm run migration:run
```

### 5. Start Server
```bash
npm run start:dev
```

---

## 📡 API Endpoints

### 1. Request Password Reset

**Endpoint:** `POST /auth/forgot-password`

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:** (Always returns success)
```json
{
  "message": "If an account exists with this email, a password reset link has been sent.",
  "success": true
}
```

**Status Codes:**
- `200` - Success (always, even if email doesn't exist)
- `400` - Invalid email format
- `429` - Rate limit exceeded

**cURL Example:**
```bash
curl -X POST http://localhost:3001/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

---

### 2. Reset Password

**Endpoint:** `POST /auth/reset-password`

**Request Body:**
```json
{
  "token": "abc123def456...",
  "newPassword": "MyNewSecurePass123"
}
```

**Success Response:**
```json
{
  "message": "Password reset successfully. Please login with your new password.",
  "success": true
}
```

**Error Responses:**
```json
// Invalid/Expired Token
{
  "statusCode": 400,
  "message": "Invalid or expired reset token",
  "error": "Bad Request"
}

// Already Used Token
{
  "statusCode": 400,
  "message": "This reset token has already been used",
  "error": "Bad Request"
}

// Expired Token
{
  "statusCode": 400,
  "message": "Reset token has expired. Please request a new password reset.",
  "error": "Bad Request"
}
```

**Status Codes:**
- `200` - Password reset successful
- `400` - Invalid/expired/used token or weak password

**cURL Example:**
```bash
curl -X POST http://localhost:3001/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token":"abc123def456...",
    "newPassword":"MyNewSecurePass123"
  }'
```

---

### 3. Verify Reset Token (Optional)

**Endpoint:** `POST /auth/verify-reset-token`

Useful for Flutter to check token validity before showing password form.

**Request Body:**
```json
{
  "token": "abc123def456..."
}
```

**Success Response:**
```json
{
  "valid": true,
  "message": "Token is valid",
  "email": "user@example.com"
}
```

**Invalid Response:**
```json
{
  "valid": false,
  "message": "Invalid reset token"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3001/auth/verify-reset-token \
  -H "Content-Type: application/json" \
  -d '{"token":"abc123def456..."}'
```

---

## 📱 Flutter Integration

### 1. Configure Deep Links

**Android** (`android/app/src/main/AndroidManifest.xml`):
```xml
<activity android:name=".MainActivity">
  <intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="myapp" android:host="reset-password" />
  </intent-filter>
</activity>
```

**iOS** (`ios/Runner/Info.plist`):
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>myapp</string>
    </array>
  </dict>
</array>
```

### 2. Handle Deep Link in Flutter

```dart
import 'package:uni_links/uni_links.dart';
import 'dart:async';

class PasswordResetHandler {
  StreamSubscription? _linkSubscription;

  void initDeepLinks() {
    // Handle deep link when app is already running
    _linkSubscription = linkStream.listen((String? link) {
      if (link != null && link.contains('reset-password')) {
        _handleResetLink(link);
      }
    });

    // Handle deep link when app starts from link
    getInitialLink().then((String? link) {
      if (link != null && link.contains('reset-password')) {
        _handleResetLink(link);
      }
    });
  }

  void _handleResetLink(String link) {
    // Parse: myapp://reset-password?token=abc123
    final uri = Uri.parse(link);
    final token = uri.queryParameters['token'];
    
    if (token != null) {
      // Navigate to password reset screen
      Navigator.pushNamed(
        context,
        '/reset-password',
        arguments: {'token': token},
      );
    }
  }

  void dispose() {
    _linkSubscription?.cancel();
  }
}
```

### 3. Call Backend APIs

```dart
import 'package:dio/dio.dart';

class AuthService {
  final Dio _dio = Dio(BaseOptions(
    baseUrl: 'http://10.0.2.2:3001', // Android emulator
  ));

  // Request password reset
  Future<bool> forgotPassword(String email) async {
    try {
      final response = await _dio.post('/auth/forgot-password', 
        data: {'email': email}
      );
      return response.statusCode == 200;
    } catch (e) {
      print('Forgot password error: $e');
      return false;
    }
  }

  // Verify token (optional - before showing form)
  Future<Map<String, dynamic>?> verifyResetToken(String token) async {
    try {
      final response = await _dio.post('/auth/verify-reset-token',
        data: {'token': token}
      );
      return response.data;
    } catch (e) {
      return null;
    }
  }

  // Reset password with token
  Future<bool> resetPassword(String token, String newPassword) async {
    try {
      final response = await _dio.post('/auth/reset-password',
        data: {
          'token': token,
          'newPassword': newPassword,
        }
      );
      return response.statusCode == 200;
    } on DioException catch (e) {
      if (e.response?.statusCode == 400) {
        throw Exception(e.response?.data['message'] ?? 'Invalid token');
      }
      throw Exception('Network error');
    }
  }
}
```

### 4. Flutter UI Flow

```dart
// 1. Forgot Password Screen
class ForgotPasswordScreen extends StatelessWidget {
  Future<void> _handleSubmit(String email) async {
    final success = await authService.forgotPassword(email);
    if (success) {
      // Show success message
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Check your email for reset link'))
      );
    }
  }
}

// 2. Reset Password Screen (opened from deep link)
class ResetPasswordScreen extends StatefulWidget {
  final String token;
  
  Future<void> _handleReset(String newPassword) async {
    try {
      final success = await authService.resetPassword(token, newPassword);
      if (success) {
        // Navigate to login
        Navigator.pushNamedAndRemoveUntil(context, '/login', (_) => false);
      }
    } catch (e) {
      // Show error
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString()))
      );
    }
  }
}
```

---

## 📧 Email Template

The system sends a professional HTML email with:

✅ Branded header with gradient  
✅ Clear call-to-action button  
✅ Expiration time (1 hour)  
✅ Fallback plain URL  
✅ Security warning  
✅ Mobile-responsive design  

**Preview:**
```
Subject: Reset Your FootSmart Pro Password

🔒 Password Reset Request

Hi John Doe,

We received a request to reset your FootSmart Pro password.

[Reset Password Button]

⏰ This link expires in 1 hour

⚠️ Didn't request this?
If you didn't request a password reset, please ignore this email.
```

---

## 🧪 Testing

### Test Forgot Password
```bash
curl -X POST http://localhost:3001/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

### Check Email
1. Open your email client
2. Find email from your SMTP_FROM_EMAIL
3. Copy the token from the link: `myapp://reset-password?token=XXX`

### Test Reset Password
```bash
curl -X POST http://localhost:3001/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token":"<PASTE_TOKEN_HERE>",
    "newPassword":"NewSecurePass123"
  }'
```

### Test Rate Limiting
```bash
# Send 4 requests quickly (should get 429 on 4th)
for i in {1..4}; do
  curl -X POST http://localhost:3001/auth/forgot-password \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com"}'
  echo ""
done
```

---

## 🚀 Production Checklist

### Security
- [ ] Use strong JWT_SECRET (256+ bits random)
- [ ] Enable HTTPS only (no HTTP)
- [ ] Configure CORS properly
- [ ] Add Helmet middleware for security headers
- [ ] Use environment variable validation
- [ ] Store secrets in secure vault (AWS Secrets Manager, etc.)

### Email
- [ ] Use production email service (SendGrid, AWS SES, Postmark)
- [ ] Configure SPF, DKIM, DMARC DNS records
- [ ] Test email deliverability
- [ ] Monitor bounce rates
- [ ] Setup email queuing (BullMQ, RabbitMQ)
- [ ] Add email sending retry logic

### Rate Limiting
- [ ] Implement Redis-based rate limiting
- [ ] Use `@nestjs/throttler` package
- [ ] Add CAPTCHA after N failed attempts
- [ ] Monitor rate limit hits

### Monitoring
- [ ] Log all password reset attempts
- [ ] Alert on suspicious patterns
- [ ] Track email delivery rates
- [ ] Monitor token usage (detect abuse)

### Database
- [ ] Add database indexes on `token` and `user_id`
- [ ] Setup token cleanup job (delete expired/used tokens)
- [ ] Backup database regularly

### Documentation
- [ ] Document API in Swagger/OpenAPI
- [ ] Create user-facing help docs
- [ ] Document incident response procedures

---

## 🔍 Troubleshooting

### Email Not Sending
1. Check SMTP credentials in `.env`
2. Verify SMTP_HOST and SMTP_PORT
3. For Gmail: Ensure App Password is used (not regular password)
4. Check logs: `npm run start:dev` and look for email errors
5. Test connection: Call `emailService.verifyConnection()` on startup

### Token Invalid/Expired
- Tokens expire after 1 hour
- Tokens are one-time use
- Check token hasn't been modified in transit
- Verify database has `password_reset_tokens` table

### Rate Limit Issues
- Wait 15 minutes for rate limit window to reset
- In development, restart server to clear in-memory rate limits
- In production, use Redis with TTL for distributed rate limiting

### Deep Link Not Working
- **Android:** Verify `AndroidManifest.xml` intent filter
- **iOS:** Verify `Info.plist` URL schemes
- Test deep link: `adb shell am start -W -a android.intent.action.VIEW -d "myapp://reset-password?token=test"`

---

## 📚 Additional Resources

- [Nodemailer Documentation](https://nodemailer.com/)
- [NestJS Rate Limiting](https://docs.nestjs.com/security/rate-limiting)
- [Flutter Deep Links](https://docs.flutter.dev/development/ui/navigation/deep-linking)
- [OWASP Password Reset Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)

---

## 📝 License

MIT

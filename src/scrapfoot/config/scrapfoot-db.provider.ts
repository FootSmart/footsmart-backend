import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Provider for Scrapfoot Supabase database client
 * Separate from the main app database connection
 */
export const scrapfootDbProvider = {
  provide: 'SCRAPFOOT_DB_CLIENT',
  inject: [ConfigService],
  useFactory: (configService: ConfigService): SupabaseClient => {
    // Extract Supabase credentials from scrapfoot database URL
    // Format: postgresql://user:password@host:port/database
    const scrapfootDatabaseUrl = configService.get<string>(
      'SCRAPFOOT_DATABASE_URL',
    );

    if (!scrapfootDatabaseUrl) {
      throw new Error('SCRAPFOOT_DATABASE_URL environment variable is not set');
    }

    // Parse connection string to get Supabase project URL and anon key
    // You can also pass these directly if you have them in .env
    const SCRAPFOOT_URL = configService.get<string>('SCRAPFOOT_SUPABASE_URL');
    const SCRAPFOOT_ANON_KEY = configService.get<string>(
      'SCRAPFOOT_SUPABASE_ANON_KEY',
    );

    if (!SCRAPFOOT_URL || !SCRAPFOOT_ANON_KEY) {
      throw new Error(
        'SCRAPFOOT_SUPABASE_URL and SCRAPFOOT_SUPABASE_ANON_KEY must be set',
      );
    }

    // Create and return Supabase client for scrapfoot database
    return createClient(SCRAPFOOT_URL, SCRAPFOOT_ANON_KEY);
  },
};

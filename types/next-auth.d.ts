import type { RoleKey } from '@/lib/roleTypes';
import NextAuth, { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: RoleKey;
      isDeveloper?: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    role: RoleKey;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: RoleKey;
    id: string;
    isDeveloper?: boolean;
  }
}


import "server-only"

import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import type { RoleKey } from "@/lib/roleTypes"
import { isUserDeactivated } from "@/lib/activeUsers"
import { prisma } from "@/lib/prisma"
import { resolveIsDeveloper, resolveIsSuperAdmin } from "@/lib/systemRoles"
import { syncDeveloperBootstrapForUser } from "@/lib/systemRoleUsers"
import bcrypt from "bcryptjs"

export {
  canEdit,
  canEditOverviewTab,
  canView,
  isAdmin,
  canAccessPullerTab,
  canAccessDeliveryTab,
  canAccessPurchaseOrderTab,
  canAccessEstimateTab,
  canEditDeliveryTab,
  isProjectManager,
  isDesigner,
  isSales,
  canAccessInventory,
} from "@/lib/authPermissions"

function getDeveloperEmailSet(): Set<string> {
  return new Set(
    (process.env.DEVELOPER_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isDeveloperEmail(email?: string | null): boolean {
  const normalizedEmail = email?.trim().toLowerCase()
  if (!normalizedEmail) return false
  return getDeveloperEmailSet().has(normalizedEmail)
}

export function requireDeveloper(
  session: { user?: { email?: string | null } } | null | undefined,
):
  | { ok: true; userEmail: string }
  | { ok: false; response: Response } {
  const userEmail = session?.user?.email?.trim().toLowerCase()
  if (!session?.user || !userEmail) {
    return {
      ok: false,
      response: Response.json(
        { error: "Unauthorized - Please sign in" },
        { status: 401 },
      ),
    }
  }

  if (!isDeveloperEmail(userEmail)) {
    return {
      ok: false,
      response: Response.json(
        { error: "Forbidden - Developer access required" },
        { status: 403 },
      ),
    }
  }

  return { ok: true, userEmail }
}

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          if (process.env.NODE_ENV === 'development') {
            console.error('❌ Auth: Missing email or password');
          }
          throw new Error("Invalid credentials")
        }

        if (process.env.NODE_ENV === 'development') {
          console.log('🔍 Auth: Attempting login for:', credentials.email);
        }

        // Normalize email (trim and lowercase for consistent matching)
        const normalizedEmail = credentials.email.trim().toLowerCase();
        
        const user = await prisma.user.findFirst({
          where: {
            email: {
              equals: normalizedEmail,
              mode: "insensitive",
            },
          },
        })

        if (!user) {
          if (process.env.NODE_ENV === 'development') {
            console.error('❌ Auth: User not found:', credentials.email);
          }
          throw new Error("Invalid credentials")
        }

        if (isUserDeactivated(user)) {
          if (process.env.NODE_ENV === 'development') {
            console.error('❌ Auth: User access terminated:', credentials.email);
          }
          throw new Error("Account access has been terminated")
        }

        if (!user?.password) {
          if (process.env.NODE_ENV === 'development') {
            console.error('❌ Auth: User has no password set');
          }
          throw new Error("Invalid credentials")
        }

        const isCorrectPassword = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!isCorrectPassword) {
          if (process.env.NODE_ENV === 'development') {
            console.error('❌ Auth: Password mismatch for:', credentials.email);
          }
          throw new Error("Invalid credentials")
        }

        if (process.env.NODE_ENV === 'development') {
          console.log('✅ Auth: Login successful for:', credentials.email);
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isSuperAdmin: user.isSuperAdmin,
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role
        token.id = user.id
        // Align JWT `sub` with DB User.id so values copied into session match FK targets.
        token.sub = user.id
      }

      // Always sync role/id from the database so admin role changes take effect
      // without requiring the user to sign out and back in.
      const email =
        typeof token.email === "string" ? token.email.trim().toLowerCase() : ""
      if (email) {
        try {
          const dbUser = await prisma.user.findFirst({
            where: {
              email: {
                equals: email,
                mode: "insensitive",
              },
            },
            select: {
              id: true,
              email: true,
              role: true,
              isSuperAdmin: true,
              isDeveloper: true,
              deactivatedAt: true,
            },
          })
          if (dbUser?.deactivatedAt) {
            token.deactivated = true
            return token
          }
          if (dbUser) {
            const bootstrapped = await syncDeveloperBootstrapForUser(dbUser)
            const effectiveUser = bootstrapped
              ? { ...dbUser, ...bootstrapped }
              : dbUser
            token.deactivated = false
            token.role = effectiveUser.role
            token.isSuperAdmin = resolveIsSuperAdmin(effectiveUser)
            token.isDeveloper = resolveIsDeveloper(effectiveUser)
            token.id = effectiveUser.id
            token.sub = effectiveUser.id
          }
        } catch (error) {
          console.error("Failed to refresh user role in JWT callback:", error)
        }
      }

      return token
    },
    async session({ session, token }) {
      try {
        if (process.env.NODE_ENV === 'development') {
          console.log('🔍 SESSION CALLBACK - Token received:', JSON.stringify(token));
        }
        
        if (session?.user && token) {
          if (token.deactivated) {
            return {
              ...session,
              user: undefined,
              expires: new Date(0).toISOString(),
            }
          }

          // Safely assign role and id
          (session.user as any).role = token.role || 'DESIGNER';
          (session.user as any).id =
            (token.id as string | undefined) ||
            (token.sub as string | undefined);
          (session.user as any).isDeveloper = !!token.isDeveloper;
          (session.user as any).isSuperAdmin = !!token.isSuperAdmin;
        }
        
        if (process.env.NODE_ENV === 'development') {
          console.log('✅ Session created successfully:', JSON.stringify(session));
        }
        return session
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('❌ SESSION CALLBACK ERROR:', error);
        }
        return session
      }
    }
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days for "remember me"
  },
  secret: process.env.NEXTAUTH_SECRET,
  // Allow NextAuth to work with both localhost and network IP
  // In development, use the request origin dynamically
  trustHost: true,
} as NextAuthOptions

/**
 * Resolves the Prisma `User.id` for audit FKs. Session `id`/`sub` can drift from the DB
 * (e.g. stale JWT); email lookup is authoritative.
 */
/**
 * Authoritative system role from the database. Session JWT role can lag behind
 * until the next session read; use this for permission checks on the server.
 */
export async function resolveSessionUserRole(
  session: { user?: { email?: string | null; role?: string | null } } | null | undefined,
): Promise<RoleKey | null> {
  if (!session?.user) return null

  const email = session.user.email?.trim().toLowerCase()
  if (email) {
    const byEmail = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
      select: { role: true },
    })
    if (byEmail) return byEmail.role
  }

  const tokenRole = session.user.role
  if (
    tokenRole === "ADMIN" ||
    tokenRole === "PROJECT_MANAGER" ||
    tokenRole === "DESIGNER" ||
    tokenRole === "SALES" ||
    tokenRole === "VIEWER"
  ) {
    return tokenRole
  }

  return null
}

export async function resolveSessionUserIdForAudit(
  session: { user?: { email?: string | null; id?: string | null } } | null | undefined,
): Promise<string | null> {
  if (!session?.user) return null
  const email = session.user.email?.trim().toLowerCase()
  if (email) {
    const byEmail = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    })
    if (byEmail) return byEmail.id
  }
  const rawId = typeof session.user.id === "string" ? session.user.id.trim() : ""
  if (rawId) {
    const byId = await prisma.user.findUnique({
      where: { id: rawId },
      select: { id: true },
    })
    if (byId) return byId.id
  }
  return null
}


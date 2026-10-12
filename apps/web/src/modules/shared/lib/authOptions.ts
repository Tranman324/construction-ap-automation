/**
 * NextAuth configuration — extracted into its own module so it can be
 * imported by both the NextAuth route handler AND the authenticated
 * backend proxy at /api/backend/[...path]/route.ts.
 *
 * Next.js App Router route.ts files are restricted in what they can export
 * (only HTTP method handlers + a few config consts), so shared auth config
 * must live outside of any route.ts file.
 */

import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import AzureADProvider from "next-auth/providers/azure-ad";
import {
  getRoleByName,
  getUserByEmail,
  getUserById,
  getUserPermissions,
  matchTitleRule,
  upsertUser,
  type ToolboxUserRecord,
} from "@/modules/shared/lib/userQueries";

function getAzureId(profile: unknown, providerAccountId: string | undefined, token: JWT): string | null {
  if (profile && typeof profile === "object") {
    const azureProfile = profile as { oid?: unknown };
    if (typeof azureProfile.oid === "string" && azureProfile.oid.length > 0) {
      return azureProfile.oid;
    }
  }

  if (typeof providerAccountId === "string" && providerAccountId.length > 0) {
    return providerAccountId;
  }

  return typeof token.sub === "string" ? token.sub : null;
}

function isAdminUser(user: ToolboxUserRecord): boolean {
  return user.role.name === "admin" && user.role.isSystem === true;
}

function applyResolvedAuth(token: JWT, user: ToolboxUserRecord, permissions: string[]): JWT {
  token.name = user.name;
  token.email = user.email;
  token.jobTitle = user.job_title ?? null;
  token.userId = user.id;
  token.role = user.role.name;
  token.roleId = user.role.id;
  token.isAdmin = isAdminUser(user);
  token.roleVersion = user.role_version;
  token.permissions = permissions;
  return token;
}

function hasResolvedAuthSlice(token: JWT): boolean {
  return typeof token.userId === "string"
    && typeof token.role === "string"
    && typeof token.roleId === "string"
    && typeof token.isAdmin === "boolean"
    && typeof token.roleVersion === "number"
    && Array.isArray(token.permissions);
}

async function resolveDefaultRoleId(jobTitle: string | null): Promise<string | null> {
  const matchedRule = await matchTitleRule(jobTitle);
  if (matchedRule?.role_id) {
    return matchedRule.role_id;
  }

  const employeeRole = await getRoleByName("employee");
  return employeeRole?.id ?? null;
}

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: { params: { scope: "openid profile email User.Read" } },
    }),
  ],
  session: {
    strategy: "jwt",
    // Users are required to re-authenticate once per week
    maxAge: 7 * 24 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, account, profile, user }) {
      // On initial sign-in, fetch jobTitle from Microsoft Graph.
      // The OIDC id_token does not include jobTitle by default.
      if (account?.access_token) {
        try {
          const res = await fetch(
            "https://graph.microsoft.com/v1.0/me?$select=jobTitle",
            { headers: { Authorization: `Bearer ${account.access_token}` } }
          );
          if (res.ok) {
            const data = (await res.json()) as Record<string, unknown>;
            token.jobTitle = (data.jobTitle as string) ?? null;
          }
        } catch {
          token.jobTitle = null;
        }
      }

      const email = typeof token.email === "string"
        ? token.email
        : typeof user?.email === "string"
          ? user.email
          : "";

      if (!email) {
        return token;
      }

      if (account) {
        const name = typeof token.name === "string"
          ? token.name
          : typeof user?.name === "string"
            ? user.name
            : email;
        const azureId = getAzureId(profile, account.providerAccountId, token);
        let currentUser = await getUserByEmail(email);

        if (!currentUser) {
          const roleId = await resolveDefaultRoleId(token.jobTitle ?? null);
          if (!roleId) {
            throw new Error("Unable to resolve default role");
          }

          currentUser = await upsertUser({
            email,
            name,
            azureId,
            jobTitle: token.jobTitle ?? null,
            roleId,
          });
        } else {
          if (!currentUser.is_active) {
            throw new Error("Account deactivated");
          }

          currentUser = await upsertUser({
            email,
            name,
            azureId,
            jobTitle: token.jobTitle ?? null,
            roleId: currentUser.role.id,
          });
        }

        if (!currentUser) {
          throw new Error("Unable to load user");
        }

        if (!currentUser.is_active) {
          throw new Error("Account deactivated");
        }

        const permissions = await getUserPermissions(currentUser.id);
        return applyResolvedAuth(token, currentUser, permissions);
      }

      const currentUser = (typeof token.userId === "string" ? await getUserById(token.userId) : null)
        ?? await getUserByEmail(email);

      if (!currentUser) {
        throw new Error("Unable to load user");
      }

      if (!currentUser.is_active) {
        throw new Error("Account deactivated");
      }

      const tokenRoleVersion = typeof token.roleVersion === "number" ? token.roleVersion : -1;

      if (hasResolvedAuthSlice(token) && currentUser.role_version <= tokenRoleVersion) {
        return token;
      }

      const permissions = await getUserPermissions(currentUser.id);
      return applyResolvedAuth(token, currentUser, permissions);

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.name = token.name as string;
        session.user.email = token.email as string;
        session.user.image = token.picture as string | null;
        session.user.position = token.jobTitle ?? null;
        session.user.userId = typeof token.userId === "string" ? token.userId : "";
        session.user.role = typeof token.role === "string" ? token.role : "";
        session.user.roleId = typeof token.roleId === "string" ? token.roleId : "";
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.roleVersion = typeof token.roleVersion === "number" ? token.roleVersion : 0;
        session.user.permissions = Array.isArray(token.permissions) ? token.permissions : [];
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
};

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      position?: string | null;
      userId: string;
      role: string;
      roleId: string;
      isAdmin: boolean;
      roleVersion: number;
      permissions: string[];
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    jobTitle?: string | null;
    userId?: string;
    role?: string;
    roleId?: string;
    isAdmin?: boolean;
    roleVersion?: number;
    permissions?: string[];
  }
}

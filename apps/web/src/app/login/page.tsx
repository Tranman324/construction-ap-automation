"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/modules/shared/components/ThemeToggle";
import { PlatformMeshBackground } from "@/modules/shared/components/layout/PlatformMeshBackground";
import { useAuth } from "@/modules/shared/lib/auth";
import { LoginParticleCircle } from "./LoginParticleCircle";
import { ToolboxMarkSignIn } from "./ToolboxMarkSignIn";

function LoginLoadingState() {
  return (
    <main className="relative h-dvh max-h-dvh overflow-hidden bg-background text-foreground">
      <PlatformMeshBackground />
      <div className="relative z-10 flex h-full items-center justify-center">
        <div
          aria-label="Loading session"
          className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
        />
      </div>
    </main>
  );
}

export default function LoginPage() {
  const { status } = useSession();
  const router = useRouter();
  const { signIn } = useAuth();
  const [isParticleExpanded, setIsParticleExpanded] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      router.push("/");
    }
  }, [status, router]);

  if (status === "loading" || status === "authenticated") {
    return <LoginLoadingState />;
  }

  const handleSignIn = () => {
    void signIn();
  };

  return (
    <main className="relative h-dvh max-h-dvh overflow-hidden bg-background text-foreground">
      <PlatformMeshBackground />

      <div className="absolute bottom-5 left-5 z-20 rounded-xl border border-border/60 bg-card/70 p-1.5 shadow-lg shadow-primary/10 backdrop-blur-md">
        <ThemeToggle />
      </div>

      <section className="relative z-10 flex h-full max-h-dvh items-center justify-center px-5 py-6 sm:py-8">
        <div
          data-testid="login-particle-stage"
          className="relative flex aspect-square items-center justify-center"
          style={{ width: "min(calc(100vw - 2.5rem), calc(100dvh - 4rem), 57.75rem)" }}
          onBlurCapture={() => {
            setIsParticleExpanded(false);
          }}
          onFocusCapture={() => {
            setIsParticleExpanded(true);
          }}
          onPointerEnter={() => {
            setIsParticleExpanded(true);
          }}
          onPointerLeave={() => {
            setIsParticleExpanded(false);
          }}
        >
          <LoginParticleCircle
            className="absolute inset-0"
            densityScale={0.5}
            motionScale={isParticleExpanded ? 1.44 : 0}
            thicknessScale={isParticleExpanded ? 1 : 0.45}
          />
          <ToolboxMarkSignIn isActive={isParticleExpanded} onSignIn={handleSignIn} />
        </div>
      </section>
    </main>
  );
}

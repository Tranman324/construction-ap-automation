import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/modules/shared/components/ui/tooltip";
import { Providers } from "@/modules/shared/lib/providers"; // Task 1.5: QueryClientProvider
import { AuthProvider } from "@/modules/shared/lib/auth"; // Task 1.6: Auth placeholder
import { Toaster } from "@/modules/shared/components/ui/toaster";
import "./globals.css";

// DS decision 2026-06-08 (CODE_ALIGNMENT.md §1): Inter + JetBrains Mono.
// CSS var names kept as --font-geist-* so globals.css needs zero changes.
const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Toolbox",
  description: "NCG Invoice Review Dashboard",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/toolbox-mark.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          storageKey="ncg-theme"
          enableSystem={false}
        >
          <TooltipProvider>
            <Providers>
              <AuthProvider>
                {children}
                <Toaster />
              </AuthProvider>
            </Providers>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

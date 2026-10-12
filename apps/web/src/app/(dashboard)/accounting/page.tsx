"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AccountingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/accounting/invoices");
  }, [router]);

  return null;
}

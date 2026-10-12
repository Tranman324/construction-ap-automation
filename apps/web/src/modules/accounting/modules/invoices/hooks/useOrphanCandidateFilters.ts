"use client";

import { useEffect, useState } from "react";

import type { OrphanCandidateParams } from "@/modules/accounting/modules/invoices/hooks/queries";

export interface OrphanCandidateFilters {
  query: string;
  page: number;
  params: OrphanCandidateParams;
  setQuery: (query: string) => void;
  setPage: (page: number) => void;
}

/** Keeps typing responsive while the resource-scoped candidate query debounces. */
export function useOrphanCandidateFilters(): OrphanCandidateFilters {
  const [query, setQueryState] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  function setQuery(nextQuery: string) {
    setQueryState(nextQuery);
    setPage(1);
  }

  return {
    query,
    page,
    params: { page, ...(debouncedQuery ? { q: debouncedQuery } : {}) },
    setQuery,
    setPage,
  };
}

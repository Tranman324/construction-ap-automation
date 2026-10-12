"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";

interface PaginationBarProps {
  page: number;
  pages: number;
  total: number;
  limit: number;
  selectedCount?: number;
  onPageChange: (p: number) => void;
  onLimitChange: (l: number) => void;
}

const PAGE_SIZES = [10, 25, 50, 100];

export function PaginationBar({
  page,
  pages,
  total,
  limit,
  selectedCount = 0,
  onPageChange,
  onLimitChange,
}: PaginationBarProps) {
  const pageCount = Math.max(pages, 1);
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * limit + 1;
  const rangeEnd = Math.min(safePage * limit, total);

  return (
    <div className="tbx-pager">
      <div className="tbx-pager__left">
        <span className="tbx-pager__range">
          {rangeStart.toLocaleString()}-{rangeEnd.toLocaleString()} of {total.toLocaleString()}
        </span>
        {selectedCount > 0 && (
          <span className="tbx-pager__sel">
            {selectedCount.toLocaleString()} selected across all pages
          </span>
        )}
      </div>

      <div className="tbx-pager__right">
        <label className="tbx-pager__size">
          Rows
          <Select
            value={String(limit)}
            onValueChange={(v) => onLimitChange(Number(v))}
          >
            <SelectTrigger size="sm" className="w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <div className="tbx-pager__nav">
          <Button
            variant="outline"
            size="icon"
            className="tbx-iconbtn-lg"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="tbx-pager__page">
            Page <strong>{safePage}</strong> / {pageCount}
          </span>

          <Button
            variant="outline"
            size="icon"
            className="tbx-iconbtn-lg"
            disabled={safePage >= pageCount}
            onClick={() => onPageChange(safePage + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DateCellProps {
  dateStr: string | null;
}

interface DateParts {
  month: number;
  day: number;
  year: number;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function parseDateParts(dateStr: string): DateParts | null {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return {
      year,
      month,
      day,
    };
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export function DateCell({ dateStr }: DateCellProps) {
  if (!dateStr) return <span className="text-muted-foreground">—</span>;
  const parts = parseDateParts(dateStr);
  if (!parts) return <span className="text-muted-foreground">—</span>;
  const month = padDatePart(parts.month);
  const day = padDatePart(parts.day);
  const year = padDatePart(parts.year % 100);

  return (
    <span className="tbx-date whitespace-nowrap tabular-nums">
      {month}/{day}
      <span className="tbx-date__y">/{year}</span>
    </span>
  );
}

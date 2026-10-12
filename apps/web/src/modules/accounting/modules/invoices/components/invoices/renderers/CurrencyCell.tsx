const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

interface CurrencyCellProps {
  amount: number | null;
}

export function CurrencyCell({ amount }: CurrencyCellProps) {
  if (amount === null) return <span className="text-muted-foreground">—</span>;
  return <span className="tbx-money tabular-nums">{formatter.format(amount)}</span>;
}

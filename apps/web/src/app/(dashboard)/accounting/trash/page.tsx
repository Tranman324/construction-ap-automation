import { redirect } from "next/navigation";

export default function TrashPage() {
  redirect("/accounting/invoices?status=discarded");
  return null;
}

import { redirect } from "next/navigation";

export default function DocumentsPage() {
  redirect("/accounting/invoices?status=documents");
  return null;
}

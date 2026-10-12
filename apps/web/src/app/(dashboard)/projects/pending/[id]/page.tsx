import { PendingReview } from '@/modules/projects/components/setup/PendingReview';

export default async function PendingReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PendingReview id={id} />;
}

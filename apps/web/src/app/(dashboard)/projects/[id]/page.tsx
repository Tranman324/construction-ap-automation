import { ProjectDetail } from '@/modules/projects/components/detail/ProjectDetail';
import { ProjectErrorBoundary } from '@/modules/projects/components/detail/ProjectErrorBoundary';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProjectErrorBoundary>
      <ProjectDetail id={id} />
    </ProjectErrorBoundary>
  );
}

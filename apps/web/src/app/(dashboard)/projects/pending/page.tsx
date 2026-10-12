'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { ApprovalQueue } from '@/modules/projects/components/setup/ApprovalQueue';

export default function PendingProjectsPage() {
  const router = useRouter();

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 sm:px-6 pt-3 pb-1">
        <button
          onClick={() => router.push('/projects')}
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          All Projects
        </button>
      </div>
      <div className="flex-1 px-4 sm:px-6 py-6">
        <ApprovalQueue />
      </div>
    </div>
  );
}

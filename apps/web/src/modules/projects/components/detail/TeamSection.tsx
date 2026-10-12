'use client';

import { useProjectTeam } from '@/modules/projects/hooks/queries';
import { getUserById } from '@/modules/projects/mock/index';
import type { ProjectTeamMember } from '@/modules/projects/types/project';
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import { Badge } from '@/modules/shared/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/shared/components/ui/card';
import { Skeleton } from '@/modules/shared/components/ui/skeleton';

export function TeamSection({ projectId }: { projectId: string }) {
  const { data: rawTeam, isLoading } = useProjectTeam(projectId);
  const team: ProjectTeamMember[] = rawTeam ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (team.length === 0) {
    return <p className="text-sm text-muted-foreground">No team members assigned.</p>;
  }

  const pms = team.filter((m) => m.role === 'pm');
  const supers = team.filter((m) => m.role === 'superintendent');

  return (
    <div className="space-y-4">
      {pms.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Project Managers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pms.map((member) => {
              const user = getUserById(member.user_id);
              return (
                <div key={member.id} className="flex items-center gap-3">
                  <UserAvatar
                    user={{ name: user?.name ?? member.user_id, image: user?.avatar_url }}
                    size="md"
                  />
                  <span className="text-sm font-medium flex-1">
                    {user?.name ?? member.user_id}
                  </span>
                  <Badge variant="outline">PM</Badge>
                  {member.is_primary && <Badge variant="secondary">Primary</Badge>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {supers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Superintendents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {supers.map((member) => {
              const user = getUserById(member.user_id);
              return (
                <div key={member.id} className="flex items-center gap-3">
                  <UserAvatar
                    user={{ name: user?.name ?? member.user_id, image: user?.avatar_url }}
                    size="md"
                  />
                  <span className="text-sm font-medium flex-1">
                    {user?.name ?? member.user_id}
                  </span>
                  <Badge variant="outline">Superintendent</Badge>
                  {member.is_primary && <Badge variant="secondary">Primary</Badge>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

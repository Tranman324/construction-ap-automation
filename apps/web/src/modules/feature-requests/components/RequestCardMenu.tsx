"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { NewRequestDialog } from "@/modules/feature-requests/components/NewRequestDialog";
import { useDeleteRequest } from "@/modules/feature-requests/hooks/mutations";
import type { FeatureRequest } from "@/modules/feature-requests/types";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/modules/shared/components/ui/alert-dialog";
import { Button } from "@/modules/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/modules/shared/components/ui/dropdown-menu";

interface RequestCardMenuProps {
  request: FeatureRequest;
}

export function RequestCardMenu({ request }: RequestCardMenuProps) {
  const { hasPermission } = usePermissions();
  const deleteRequest = useDeleteRequest();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (!hasPermission("feature_requests.manage")) {
    return null;
  }

  function handleDelete() {
    deleteRequest.mutate(
      { id: request.id },
      {
        onSuccess: () => {
          setDeleteDialogOpen(false);
        },
      },
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => setEditDialogOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewRequestDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        editRequest={request}
      />

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            deleteRequest.reset();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete feature request?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &quot;{request.title}&quot;. This action cannot be undone.
            </AlertDialogDescription>
            {deleteRequest.isError && (
              <p className="text-sm text-destructive mt-2">
                {deleteRequest.error?.message ?? "Failed to delete request"}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRequest.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteRequest.isPending}
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
            >
              {deleteRequest.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

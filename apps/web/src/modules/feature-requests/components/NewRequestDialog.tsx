"use client";

import { useState, type FormEvent } from "react";
import {
  useCreateRequest,
  useEditRequest,
} from "@/modules/feature-requests/hooks/mutations";
import type { FeatureRequest } from "@/modules/feature-requests/types";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/modules/shared/components/ui/dialog";
import { Input } from "@/modules/shared/components/ui/input";
import { Textarea } from "@/modules/shared/components/ui/textarea";
import { cn } from "@/modules/shared/lib/utils";

interface NewRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editRequest?: FeatureRequest;
}

interface FormErrors {
  title?: string;
  description?: string;
}

interface NewRequestDialogFormProps {
  editRequest?: FeatureRequest;
  isEditing: boolean;
  isPending: boolean;
  mutationError?: string;
  onCancel: () => void;
  onSubmitRequest: (title: string, description: string) => void;
}

const TITLE_LIMIT = 120;
const DESCRIPTION_LIMIT = 500;

function getCountTone(length: number, limit: number) {
  if (length >= limit) return "text-destructive";
  if (length >= limit * 0.8) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

export function NewRequestDialog({
  open,
  onOpenChange,
  editRequest,
}: NewRequestDialogProps) {
  const createRequest = useCreateRequest();
  const editRequestMutation = useEditRequest();
  const isEditing = !!editRequest;
  const isPending = createRequest.isPending || editRequestMutation.isPending;

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
  }

  function handleSubmitRequest(title: string, description: string) {
    const onSuccess = () => {
      handleOpenChange(false);
    };

    if (isEditing && editRequest) {
      editRequestMutation.mutate(
        {
          id: editRequest.id,
          payload: {
            title,
            description,
          },
        },
        { onSuccess },
      );
      return;
    }

    createRequest.mutate(
      {
        title,
        description,
      },
      { onSuccess },
    );
  }

  const mutationError = createRequest.error?.message ?? editRequestMutation.error?.message;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {open && (
        <NewRequestDialogForm
          key={editRequest?.id ?? "new-request"}
          editRequest={editRequest}
          isEditing={isEditing}
          isPending={isPending}
          mutationError={mutationError}
          onCancel={() => handleOpenChange(false)}
          onSubmitRequest={handleSubmitRequest}
        />
      )}
    </Dialog>
  );
}

function NewRequestDialogForm({
  editRequest,
  isEditing,
  isPending,
  mutationError,
  onCancel,
  onSubmitRequest,
}: NewRequestDialogFormProps) {
  const [title, setTitle] = useState(() => editRequest?.title ?? "");
  const [description, setDescription] = useState(() => editRequest?.description ?? "");
  const [errors, setErrors] = useState<FormErrors>({});

  function validateForm() {
    const nextErrors: FormErrors = {};
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();

    if (!trimmedTitle) {
      nextErrors.title = "Title is required.";
    } else if (trimmedTitle.length > TITLE_LIMIT) {
      nextErrors.title = `Title must be ${TITLE_LIMIT} characters or fewer.`;
    }

    if (!trimmedDescription) {
      nextErrors.description = "Description is required.";
    } else if (trimmedDescription.length > DESCRIPTION_LIMIT) {
      nextErrors.description = `Description must be ${DESCRIPTION_LIMIT} characters or fewer.`;
    }

    setErrors(nextErrors);
    return {
      isValid: Object.keys(nextErrors).length === 0,
      trimmedTitle,
      trimmedDescription,
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    const { isValid, trimmedTitle, trimmedDescription } = validateForm();
    if (!isValid) return;

    onSubmitRequest(trimmedTitle, trimmedDescription);
  }

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{isEditing ? "Edit Feature Request" : "New Feature Request"}</DialogTitle>
        <DialogDescription>
          {isEditing
            ? "Refine the request details before saving changes."
            : "Capture the problem clearly so the team can prioritize the right work."}
        </DialogDescription>
      </DialogHeader>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="feature-request-title" className="text-sm font-medium">
              Title
            </label>
            <span className={cn("text-xs", getCountTone(title.length, TITLE_LIMIT))}>
              {title.length}/{TITLE_LIMIT}
            </span>
          </div>
          <Input
            id="feature-request-title"
            value={title}
            maxLength={TITLE_LIMIT}
            onChange={(event) => {
              setTitle(event.target.value);
              if (errors.title) setErrors((current) => ({ ...current, title: undefined }));
            }}
            aria-invalid={!!errors.title}
            placeholder="Summarize the feature request"
            disabled={isPending}
          />
          {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="feature-request-description" className="text-sm font-medium">
              Description
            </label>
            <span className={cn("text-xs", getCountTone(description.length, DESCRIPTION_LIMIT))}>
              {description.length}/{DESCRIPTION_LIMIT}
            </span>
          </div>
          <Textarea
            id="feature-request-description"
            value={description}
            maxLength={DESCRIPTION_LIMIT}
            onChange={(event) => {
              setDescription(event.target.value);
              if (errors.description) setErrors((current) => ({ ...current, description: undefined }));
            }}
            aria-invalid={!!errors.description}
            placeholder="Describe the friction, desired outcome, and who benefits."
            disabled={isPending}
            rows={5}
          />
          {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
        </div>

        {mutationError && <p className="text-sm text-destructive">{mutationError}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? (isEditing ? "Saving..." : "Submitting...") : isEditing ? "Save Changes" : "Submit Request"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
export type VoteType = "must_have" | "nice_to_have";

export type Category =
  | "workflow"
  | "reporting"
  | "integration"
  | "design"
  | "admin";

export type Status = "open" | "in_progress" | "completed" | "declined";

export interface Voter {
  name: string;
  email: string;
  voteType: VoteType;
  image: string | null;
}

export interface FeatureRequest {
  id: string;
  title: string;
  description: string;
  category: Category;
  status: Status;
  authorName: string;
  authorEmail: string;
  authorImage: string | null;
  mustHaveVotes: number;
  niceToHaveVotes: number;
  totalVotes: number;
  currentUserVote: VoteType | null;
  voters: Voter[];
  createdAt: string;
  updatedAt: string;
}

export interface FeatureRequestsResponse {
  requests: FeatureRequest[];
  total: number;
}

export interface CreateRequestPayload {
  title: string;
  description: string;
  category?: Category;
}
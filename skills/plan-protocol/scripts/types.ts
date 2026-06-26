export interface SecurityConcern {
  id: string;
  description: string;
  severity: string;
  mitigation: string;
}

export interface Blocker {
  reason: string;
  created_at?: string;
  resolved?: boolean;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  verification_method: string;
  security_concerns?: SecurityConcern[];
  status?: "pending" | "passed" | "failed" | "blocked";
}

export interface Checkpoint {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  acceptance_criteria: AcceptanceCriterion[];
  security_concerns?: SecurityConcern[];
  blockers?: Blocker[];
}

export interface Plan {
  title: string;
  description: string;
  overview: string;
  version?: string;
  created_at?: string;
  updated_at?: string;
  checkpoints: Checkpoint[];
}

export interface PlanData {
  plan: Plan;
}

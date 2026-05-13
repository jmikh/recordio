export interface WorkspaceMember {
    user_id: string;
    role: 'viewer' | 'creator' | 'admin';
    email: string;
    name: string | null;
    created_at: string;
}

export interface WorkspaceInvitation {
    id: string;
    email: string;
    role: 'viewer' | 'creator' | 'admin';
    invited_by: string;
    created_at: string;
    expires_at: string;
}

export interface WorkspaceDetails {
    id: string;
    name: string;
    owner_id: string;
    role: 'viewer' | 'creator' | 'admin';
    seats: number | null;        // creator seats
    viewer_seats: number | null; // derived: seats * 10
    members: WorkspaceMember[];
    invitations: WorkspaceInvitation[];
}

export type Tab = 'general' | 'members' | 'billing';
export type BillingInterval = 'monthly' | 'yearly';

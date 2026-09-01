import { create } from 'zustand';
import type { WorkspaceEntitlements } from '@shared/api/entitlements';

const DEV_PRO_UID = import.meta.env.VITE_DEV_PRO_UID as string | undefined;

/** Client-side dev override: force pro-shaped entitlements for VITE_DEV_PRO_UID (UI only — server gates use real DB state). */
const PRO_ENTITLEMENTS: WorkspaceEntitlements = {
    state: 'pro',
    canShare: true,
    canTranscribe: true,
    canBackgroundExport: true,
    can4k: true,
    canInvite: true,
    projectCap: null,
    trialEndsAt: null,
    canExtendTrial: false,
};

export interface WorkspaceListItem {
    id: string;
    name: string;
    owner_id: string;
    role: 'viewer' | 'creator' | 'admin';
    seats: number | null;
}

/** Single plan since the billing revamp — no plan field, seats >= 1. */
export interface WorkspaceSubscription {
    status: 'active' | 'canceled' | 'past_due' | 'inactive' | null;
    currentPeriodEnd: Date | null;
    /** Scheduled cancellation date; null = renews */
    cancelAt: Date | null;
    billingInterval: 'monthly' | 'yearly' | null;
    seats: number;
    stripeCustomerId: string | null;
}

export interface WorkspaceState {
    // Current workspace
    workspaceId: string | null;
    workspaceName: string | null;
    workspaceOwnerId: string | null;
    workspaceRole: 'viewer' | 'creator' | 'admin' | null;
    workspaceSeats: number | null;
    workspaceList: WorkspaceListItem[];

    /** True once the initial workspace_get_default has resolved. Gates authenticated UI. */
    workspaceReady: boolean;

    // Billing — workspace-scoped subscription + server-computed entitlements
    subscription: WorkspaceSubscription | null;
    /** From /subscription-get; null until loaded (treat as free) */
    entitlements: WorkspaceEntitlements | null;
    hasActivePlan: boolean; // active subscription (incl. past_due dunning)

    setWorkspace: (id: string, name: string, ownerId: string, role?: string | null, seats?: number | null) => void;
    setWorkspaceList: (list: WorkspaceListItem[]) => void;
    setSubscription: (
        sub: WorkspaceSubscription | null,
        entitlements: WorkspaceEntitlements,
        userId?: string,
    ) => void;
    setWorkspaceReady: () => void;
    clearWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
    workspaceId: null,
    workspaceName: null,
    workspaceOwnerId: null,
    workspaceRole: null,
    workspaceSeats: null,
    workspaceList: [],
    workspaceReady: false,
    subscription: null,
    entitlements: null,
    hasActivePlan: false,

    setWorkspace: (workspaceId, workspaceName, workspaceOwnerId, role, seats = null) => {
        set({
            workspaceId,
            workspaceName,
            workspaceOwnerId,
            workspaceRole: (role as WorkspaceState['workspaceRole']) ?? null,
            workspaceSeats: seats ?? null,
        });
    },

    setWorkspaceList: (workspaceList) => {
        set({ workspaceList });
    },

    setWorkspaceReady: () => set({ workspaceReady: true }),

    setSubscription: (sub, entitlements, userId) => {
        const isDevPro = DEV_PRO_UID && userId ? userId === DEV_PRO_UID : false;
        const hasActivePlan =
            isDevPro || sub?.status === 'active' || sub?.status === 'past_due';
        set({
            subscription: sub,
            entitlements: isDevPro ? PRO_ENTITLEMENTS : entitlements,
            hasActivePlan,
        });
    },

    clearWorkspace: () => {
        set({
            workspaceId: null,
            workspaceName: null,
            workspaceOwnerId: null,
            workspaceRole: null,
            workspaceSeats: null,
            workspaceList: [],
            workspaceReady: false,
            subscription: null,
            entitlements: null,
            hasActivePlan: false,
        });
    },
}));

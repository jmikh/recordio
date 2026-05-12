import { create } from 'zustand';

const DEV_PRO_UID = import.meta.env.VITE_DEV_PRO_UID as string | undefined;

export interface WorkspaceListItem {
    id: string;
    name: string;
    owner_id: string;
    is_personal: boolean;
    role: 'viewer' | 'creator' | 'admin';
    seats: number | null;
}

export interface WorkspaceSubscription {
    status: 'active' | 'canceled' | 'past_due' | 'inactive' | null;
    plan: 'pro' | 'business';
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    billingInterval: 'monthly' | 'yearly' | null;
    seats: number | null;
    stripeCustomerId: string | null;
}

export interface WorkspaceState {
    // Current workspace
    workspaceId: string | null;
    workspaceName: string | null;
    workspaceOwnerId: string | null;
    workspaceRole: 'viewer' | 'creator' | 'admin' | null;
    workspaceIsPersonal: boolean;
    workspaceSeats: number | null;
    workspaceList: WorkspaceListItem[];

    // Billing — workspace-scoped subscription
    subscription: WorkspaceSubscription | null;
    hasActivePlan: boolean; // active pro or business subscription

    setWorkspace: (id: string, name: string, ownerId: string, role?: string | null, isPersonal?: boolean, seats?: number | null) => void;
    setWorkspaceList: (list: WorkspaceListItem[]) => void;
    setSubscription: (sub: WorkspaceSubscription, userId?: string) => void;
    clearWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
    workspaceId: null,
    workspaceName: null,
    workspaceOwnerId: null,
    workspaceRole: null,
    workspaceIsPersonal: true,
    workspaceSeats: null,
    workspaceList: [],
    subscription: null,
    hasActivePlan: false,

    setWorkspace: (workspaceId, workspaceName, workspaceOwnerId, role, isPersonal = false, seats = null) => {
        set({
            workspaceId,
            workspaceName,
            workspaceOwnerId,
            workspaceRole: (role as WorkspaceState['workspaceRole']) ?? null,
            workspaceIsPersonal: isPersonal,
            workspaceSeats: seats ?? null,
        });
    },

    setWorkspaceList: (workspaceList) => {
        set({ workspaceList });
    },

    setSubscription: (sub, userId) => {
        const isDevPro = DEV_PRO_UID && userId ? userId === DEV_PRO_UID : false;
        const hasActivePlan = isDevPro || sub.status === 'active' || sub.status === 'past_due';
        set({ subscription: sub, hasActivePlan });
    },

    clearWorkspace: () => {
        set({
            workspaceId: null,
            workspaceName: null,
            workspaceOwnerId: null,
            workspaceRole: null,
            workspaceIsPersonal: true,
            workspaceSeats: null,
            workspaceList: [],
            subscription: null,
            hasActivePlan: false,
        });
    },
}));

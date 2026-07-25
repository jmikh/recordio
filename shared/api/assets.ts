/**
 * Client↔server contract for the asset routes
 * (plans/shared-api-contract.md). The schema objects here ARE the
 * server's runtime validation — server/src/routes/assets/*.ts import them
 * verbatim — and the webapp's compile-time types via ApiRoutes
 * (./index). Pure schemas + Static<> types: this folder imports nothing
 * from server/ or webapp/.
 */
import { Type, type Static } from '@sinclair/typebox';

export const AssetTypeSchema = Type.Union([
    Type.Literal('background'),
    Type.Literal('music'),
]);
export type AssetType = Static<typeof AssetTypeSchema>;

// ── POST /asset-list ─────────────────────────────────────────────

export const AssetListRequestSchema = Type.Object({
    assetType: AssetTypeSchema,
});
export type AssetListRequest = Static<typeof AssetListRequestSchema>;

export const AssetListResponseSchema = Type.Object({
    assets: Type.Array(Type.Object({
        id: Type.String(),
        assetType: AssetTypeSchema,
        storagePath: Type.String(),
        name: Type.Union([Type.String(), Type.Null()]),
        sizeBytes: Type.Number(),
        createdAt: Type.String(),
        downloadUrl: Type.String(),
    })),
});
export type AssetListResponse = Static<typeof AssetListResponseSchema>;

// ── POST /asset-delete ───────────────────────────────────────────

export const AssetDeleteRequestSchema = Type.Object({
    assetId: Type.String({ minLength: 1 }),
});
export type AssetDeleteRequest = Static<typeof AssetDeleteRequestSchema>;

export const AssetDeleteResponseSchema = Type.Object({
    storagePath: Type.Union([Type.String(), Type.Null()]),
});
export type AssetDeleteResponse = Static<typeof AssetDeleteResponseSchema>;

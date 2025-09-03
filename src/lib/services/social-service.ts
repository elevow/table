// US-065: Social Integration - service layer
import type { Pool } from 'pg';

export interface SocialShareRecord {
  id: string;
  userId: string;
  kind: 'hand' | 'achievement' | 'stats';
  refId?: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  message?: string | null;
  platforms: string[];
  shareSlug?: string | null;
  payload?: any;
  createdAt: Date;
}

export class SocialService {
  constructor(private pool: Pool) {}

  async createShare(input: {
    userId: string;
    kind: 'hand' | 'achievement' | 'stats';
    refId?: string;
    visibility?: 'public' | 'unlisted' | 'private';
    message?: string;
    platforms?: string[];
    payload?: any;
    shareSlug?: string;
  }): Promise<SocialShareRecord> {
    const {
      userId,
      kind,
      refId = null,
      visibility = 'public',
      message = null,
      platforms = [],
      payload = null,
      shareSlug = null,
    } = input;
    if (!userId) throw new Error('userId is required');
    if (!kind) throw new Error('kind is required');
    const res = await this.pool.query(
      `INSERT INTO social_shares (user_id, kind, ref_id, visibility, message, platforms, payload, share_slug)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, user_id, kind, ref_id, visibility, message, platforms, payload, share_slug, created_at`,
      [userId, kind, refId, visibility, message, platforms, payload, shareSlug]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      kind: r.kind,
      refId: r.ref_id,
      visibility: r.visibility,
      message: r.message,
      platforms: r.platforms || [],
      payload: r.payload,
      shareSlug: r.share_slug,
      createdAt: r.created_at,
    };
  }

  async recordEngagement(shareId: string, metric: 'click' | 'like' | 'reshare', inc = 1): Promise<{ shareId: string; metric: string; count: number }>{
    if (!shareId) throw new Error('shareId is required');
    if (!metric) throw new Error('metric is required');
    const res = await this.pool.query(
      `INSERT INTO social_engagement (share_id, metric, count)
       VALUES ($1,$2,$3)
       ON CONFLICT (share_id, metric) DO UPDATE SET count = social_engagement.count + EXCLUDED.count, last_updated = NOW()
       RETURNING share_id, metric, count`,
      [shareId, metric, inc]
    );
    const r = res.rows[0];
    return { shareId: r.share_id, metric: r.metric, count: r.count };
  }
}

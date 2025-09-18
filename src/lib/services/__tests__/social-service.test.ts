import { SocialService, SocialShareRecord } from '../social-service';
import { Pool, QueryResult } from 'pg';

// Mock the Pool
jest.mock('pg', () => ({
  Pool: jest.fn(),
}));

describe('SocialService', () => {
  let socialService: SocialService;
  let mockPool: jest.Mocked<Pool>;
  let mockQuery: jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockQuery = jest.fn();
    mockPool = {
      query: mockQuery,
    } as any;

    socialService = new SocialService(mockPool);
  });

  describe('Constructor', () => {
    it('should create an instance with Pool', () => {
      expect(socialService).toBeInstanceOf(SocialService);
    });
  });

  describe('createShare', () => {
    const validInput = {
      userId: 'user123',
      kind: 'hand' as const,
      refId: 'hand123',
      visibility: 'public' as const,
      message: 'Great hand!',
      platforms: ['twitter', 'facebook'],
      payload: { winnings: 500 },
      shareSlug: 'hand-123-slug'
    };

    const mockDbResult = {
      id: 'share123',
      user_id: 'user123',
      kind: 'hand',
      ref_id: 'hand123',
      visibility: 'public',
      message: 'Great hand!',
      platforms: ['twitter', 'facebook'],
      payload: { winnings: 500 },
      share_slug: 'hand-123-slug',
      created_at: new Date('2024-01-01T10:00:00Z')
    };

    const expectedShareRecord: SocialShareRecord = {
      id: 'share123',
      userId: 'user123',
      kind: 'hand',
      refId: 'hand123',
      visibility: 'public',
      message: 'Great hand!',
      platforms: ['twitter', 'facebook'],
      payload: { winnings: 500 },
      shareSlug: 'hand-123-slug',
      createdAt: new Date('2024-01-01T10:00:00Z')
    };

    beforeEach(() => {
      mockQuery.mockResolvedValue({ rows: [mockDbResult] } as QueryResult);
    });

    it('should create share successfully with all fields', async () => {
      const result = await socialService.createShare(validInput);

      expect(mockPool.query).toHaveBeenCalledWith(
        `INSERT INTO social_shares (user_id, kind, ref_id, visibility, message, platforms, payload, share_slug)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, user_id, kind, ref_id, visibility, message, platforms, payload, share_slug, created_at`,
        ['user123', 'hand', 'hand123', 'public', 'Great hand!', ['twitter', 'facebook'], { winnings: 500 }, 'hand-123-slug']
      );
      expect(result).toEqual(expectedShareRecord);
    });

    it('should create share with minimal required fields', async () => {
      const minimalInput = {
        userId: 'user123',
        kind: 'achievement' as const
      };

      const minimalDbResult = {
        ...mockDbResult,
        kind: 'achievement',
        ref_id: null,
        visibility: 'public',
        message: null,
        platforms: null,
        payload: null,
        share_slug: null
      };

      mockQuery.mockResolvedValue({ rows: [minimalDbResult] } as QueryResult);

      const result = await socialService.createShare(minimalInput);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['user123', 'achievement', null, 'public', null, [], null, null]
      );
      expect(result.kind).toBe('achievement');
      expect(result.refId).toBeNull();
      expect(result.platforms).toEqual([]);
    });

    it('should create share with defaults for optional fields', async () => {
      const input = {
        userId: 'user123',
        kind: 'stats' as const
      };

      await socialService.createShare(input);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['user123', 'stats', null, 'public', null, [], null, null]
      );
    });

    it('should create share with custom visibility', async () => {
      const input = {
        userId: 'user123',
        kind: 'hand' as const,
        visibility: 'private' as const
      };

      await socialService.createShare(input);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['private'])
      );
    });

    it('should create share with unlisted visibility', async () => {
      const input = {
        userId: 'user123',
        kind: 'achievement' as const,
        visibility: 'unlisted' as const
      };

      await socialService.createShare(input);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['unlisted'])
      );
    });

    it('should create share with empty platforms array', async () => {
      const input = {
        userId: 'user123',
        kind: 'hand' as const,
        platforms: []
      };

      await socialService.createShare(input);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([[]])
      );
    });

    it('should create share with single platform', async () => {
      const input = {
        userId: 'user123',
        kind: 'hand' as const,
        platforms: ['twitter']
      };

      await socialService.createShare(input);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([['twitter']])
      );
    });

    it('should create share with complex payload', async () => {
      const complexPayload = {
        hand: { cards: ['AH', 'KD'], position: 'button' },
        stats: { profit: 250, hands: 45 },
        meta: { tournament: true, buyIn: 100 }
      };

      const input = {
        userId: 'user123',
        kind: 'hand' as const,
        payload: complexPayload
      };

      await socialService.createShare(input);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([complexPayload])
      );
    });

    it('should handle null platforms from database', async () => {
      const dbResultWithNullPlatforms = {
        ...mockDbResult,
        platforms: null
      };

      mockQuery.mockResolvedValue({ rows: [dbResultWithNullPlatforms] } as QueryResult);

      const result = await socialService.createShare(validInput);

      expect(result.platforms).toEqual([]);
    });

    it('should throw error for missing userId', async () => {
      const input = {
        userId: '',
        kind: 'hand' as const
      };

      await expect(socialService.createShare(input))
        .rejects.toThrow('userId is required');
      
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should throw error for undefined userId', async () => {
      const input = {
        userId: undefined as any,
        kind: 'hand' as const
      };

      await expect(socialService.createShare(input))
        .rejects.toThrow('userId is required');
    });

    it('should throw error for null userId', async () => {
      const input = {
        userId: null as any,
        kind: 'hand' as const
      };

      await expect(socialService.createShare(input))
        .rejects.toThrow('userId is required');
    });

    it('should throw error for missing kind', async () => {
      const input = {
        userId: 'user123',
        kind: '' as any
      };

      await expect(socialService.createShare(input))
        .rejects.toThrow('kind is required');
    });

    it('should throw error for undefined kind', async () => {
      const input = {
        userId: 'user123',
        kind: undefined as any
      };

      await expect(socialService.createShare(input))
        .rejects.toThrow('kind is required');
    });

    it('should throw error for null kind', async () => {
      const input = {
        userId: 'user123',
        kind: null as any
      };

      await expect(socialService.createShare(input))
        .rejects.toThrow('kind is required');
    });

    it('should handle all valid kind values', async () => {
      const kinds = ['hand', 'achievement', 'stats'] as const;

      for (const kind of kinds) {
        const input = { userId: 'user123', kind };
        await socialService.createShare(input);
        
        expect(mockPool.query).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([kind])
        );
      }
    });

    it('should handle database errors', async () => {
      mockQuery.mockRejectedValue(new Error('Database connection failed'));

      await expect(socialService.createShare(validInput))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle empty result set', async () => {
      mockQuery.mockResolvedValue({ 
        rows: [],
        command: 'INSERT',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      await expect(socialService.createShare(validInput))
        .rejects.toThrow(); // Should throw when trying to access rows[0]
    });
  });

  describe('recordEngagement', () => {
    const validShareId = 'share123';
    const validMetric = 'click' as const;

    const mockEngagementResult = {
      share_id: 'share123',
      metric: 'click',
      count: 5
    };

    const expectedEngagement = {
      shareId: 'share123',
      metric: 'click',
      count: 5
    };

    beforeEach(() => {
      mockQuery.mockResolvedValue({ rows: [mockEngagementResult] } as QueryResult);
    });

    it('should record engagement successfully with default increment', async () => {
      const result = await socialService.recordEngagement(validShareId, validMetric);

      expect(mockPool.query).toHaveBeenCalledWith(
        `INSERT INTO social_engagement (share_id, metric, count)
       VALUES ($1,$2,$3)
       ON CONFLICT (share_id, metric) DO UPDATE SET count = social_engagement.count + EXCLUDED.count, last_updated = NOW()
       RETURNING share_id, metric, count`,
        ['share123', 'click', 1]
      );
      expect(result).toEqual(expectedEngagement);
    });

    it('should record engagement with custom increment', async () => {
      const customIncrement = 5;
      
      await socialService.recordEngagement(validShareId, validMetric, customIncrement);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        ['share123', 'click', 5]
      );
    });

    it('should record engagement with zero increment', async () => {
      await socialService.recordEngagement(validShareId, validMetric, 0);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([0])
      );
    });

    it('should record engagement with negative increment', async () => {
      await socialService.recordEngagement(validShareId, validMetric, -2);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([-2])
      );
    });

    it('should handle all valid metric types', async () => {
      const metrics = ['click', 'like', 'reshare'] as const;

      for (const metric of metrics) {
        const result = {
          share_id: 'share123',
          metric: metric,
          count: 1
        };
        mockQuery.mockResolvedValue({ rows: [result] } as QueryResult);

        const engagement = await socialService.recordEngagement(validShareId, metric);
        
        expect(mockPool.query).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining([metric])
        );
        expect(engagement.metric).toBe(metric);
      }
    });

    it('should handle like engagement', async () => {
      const likeResult = {
        share_id: 'share123',
        metric: 'like',
        count: 10
      };
      mockQuery.mockResolvedValue({ rows: [likeResult] } as QueryResult);

      const result = await socialService.recordEngagement(validShareId, 'like');

      expect(result).toEqual({
        shareId: 'share123',
        metric: 'like',
        count: 10
      });
    });

    it('should handle reshare engagement', async () => {
      const reshareResult = {
        share_id: 'share123',
        metric: 'reshare',
        count: 3
      };
      mockQuery.mockResolvedValue({ rows: [reshareResult] } as QueryResult);

      const result = await socialService.recordEngagement(validShareId, 'reshare');

      expect(result).toEqual({
        shareId: 'share123',
        metric: 'reshare',
        count: 3
      });
    });

    it('should throw error for missing shareId', async () => {
      await expect(socialService.recordEngagement('', validMetric))
        .rejects.toThrow('shareId is required');
      
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should throw error for undefined shareId', async () => {
      await expect(socialService.recordEngagement(undefined as any, validMetric))
        .rejects.toThrow('shareId is required');
    });

    it('should throw error for null shareId', async () => {
      await expect(socialService.recordEngagement(null as any, validMetric))
        .rejects.toThrow('shareId is required');
    });

    it('should throw error for missing metric', async () => {
      await expect(socialService.recordEngagement(validShareId, '' as any))
        .rejects.toThrow('metric is required');
    });

    it('should throw error for undefined metric', async () => {
      await expect(socialService.recordEngagement(validShareId, undefined as any))
        .rejects.toThrow('metric is required');
    });

    it('should throw error for null metric', async () => {
      await expect(socialService.recordEngagement(validShareId, null as any))
        .rejects.toThrow('metric is required');
    });

    it('should handle database errors', async () => {
      mockQuery.mockRejectedValue(new Error('Constraint violation'));

      await expect(socialService.recordEngagement(validShareId, validMetric))
        .rejects.toThrow('Constraint violation');
    });

    it('should handle empty result set', async () => {
      mockQuery.mockResolvedValue({ 
        rows: [],
        command: 'UPDATE',
        rowCount: 0,
        oid: 0,
        fields: []
      } as QueryResult);

      await expect(socialService.recordEngagement(validShareId, validMetric))
        .rejects.toThrow(); // Should throw when trying to access rows[0]
    });

    it('should handle large increment values', async () => {
      const largeIncrement = 1000000;
      const largeResult = {
        share_id: 'share123',
        metric: 'click',
        count: 1000005
      };
      mockQuery.mockResolvedValue({ rows: [largeResult] } as QueryResult);

      const result = await socialService.recordEngagement(validShareId, validMetric, largeIncrement);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([1000000])
      );
      expect(result.count).toBe(1000005);
    });
  });

  describe('Edge cases and validation', () => {
    it('should allow whitespace-only shareId', async () => {
      const mockEngagementResult = {
        share_id: '   ',
        metric: 'click',
        count: 1
      };
      mockQuery.mockResolvedValue({ rows: [mockEngagementResult] } as QueryResult);

      const result = await socialService.recordEngagement('   ', 'click');

      expect(result).toEqual({
        shareId: '   ',
        metric: 'click',
        count: 1
      });
    });

    it('should allow whitespace-only userId', async () => {
      const input = {
        userId: '   ',
        kind: 'hand' as const
      };

      const mockDbResult = {
        id: 'share123',
        user_id: '   ',
        kind: 'hand',
        ref_id: null,
        visibility: 'public',
        message: null,
        platforms: null,
        payload: null,
        share_slug: null,
        created_at: new Date('2024-01-01T10:00:00Z')
      };
      mockQuery.mockResolvedValue({ rows: [mockDbResult] } as QueryResult);

      const result = await socialService.createShare(input);
      
      expect(result.userId).toBe('   ');
    });

    it('should preserve payload structure in create share', async () => {
      const nestedPayload = {
        level1: {
          level2: {
            level3: ['item1', 'item2'],
            number: 42,
            boolean: true
          }
        }
      };

      const input = {
        userId: 'user123',
        kind: 'achievement' as const,
        payload: nestedPayload
      };

      const mockDbResult = {
        id: 'share123',
        user_id: 'user123',
        kind: 'achievement',
        ref_id: null,
        visibility: 'public',
        message: null,
        platforms: null,
        payload: nestedPayload,
        share_slug: null,
        created_at: new Date('2024-01-01T10:00:00Z')
      };
      mockQuery.mockResolvedValue({ rows: [mockDbResult] } as QueryResult);

      await socialService.createShare(input);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([nestedPayload])
      );
    });

    it('should handle special characters in message', async () => {
      const specialMessage = "Just won $1,000! 🎉 Check out this amazing hand: AA vs KK 💰";
      
      const input = {
        userId: 'user123',
        kind: 'hand' as const,
        message: specialMessage
      };

      const mockDbResult = {
        id: 'share123',
        user_id: 'user123',
        kind: 'hand',
        ref_id: null,
        visibility: 'public',
        message: specialMessage,
        platforms: null,
        payload: null,
        share_slug: null,
        created_at: new Date('2024-01-01T10:00:00Z')
      };
      mockQuery.mockResolvedValue({ rows: [mockDbResult] } as QueryResult);

      await socialService.createShare(input);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([specialMessage])
      );
    });

    it('should handle extremely long platform arrays', async () => {
      const manyPlatforms = Array.from({ length: 100 }, (_, i) => `platform${i}`);
      
      const input = {
        userId: 'user123',
        kind: 'stats' as const,
        platforms: manyPlatforms
      };

      const mockDbResult = {
        id: 'share123',
        user_id: 'user123',
        kind: 'stats',
        ref_id: null,
        visibility: 'public',
        message: null,
        platforms: manyPlatforms,
        payload: null,
        share_slug: null,
        created_at: new Date('2024-01-01T10:00:00Z')
      };
      mockQuery.mockResolvedValue({ rows: [mockDbResult] } as QueryResult);

      await socialService.createShare(input);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([manyPlatforms])
      );
    });
  });
});
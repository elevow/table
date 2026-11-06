import { getPool } from '../../../../src/lib/database/pool';
import { HandHistoryService } from '../../../../src/lib/services/hand-history-service';
import { verifyRngSecurity, RNGSecurity } from '../../../../src/lib/poker/rng-security';
import { apiHandler } from '../../../../src/lib/api/handler';

function parseHashChain(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String);
  const s = String(input);
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.map(String);
  } catch {}
  return s.split(',').map(v => v.trim()).filter(Boolean);
}

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  try {
    const handId = String((req.query as any).handId || '');
    if (!handId) return res.status(400).json({ error: 'Missing handId' });

    const pool = getPool();
    const service = new HandHistoryService(pool);
    const outcomes = await service.listRunItTwiceOutcomes(handId);

    // Read optional RNG audit fields from query
    const publicSeed = (req.query as any).publicSeed ? String((req.query as any).publicSeed) : undefined;
    const proof = (req.query as any).proof ? String((req.query as any).proof) : undefined;
    const playerEntropy = (req.query as any).playerEntropy ? String((req.query as any).playerEntropy) : '';
    const timestampStr = (req.query as any).timestamp ? String((req.query as any).timestamp) : undefined;
    const timestamp = timestampStr ? Number(timestampStr) : undefined;
    const hashChain = parseHashChain((req.query as any).hashChain);

    const numberOfRuns = hashChain.length > 0 ? hashChain.length : outcomes.length;

    // If no metadata provided, respond with auditAvailable=false and outcomes
    if (!publicSeed || !proof || !timestamp || numberOfRuns === 0) {
      return res.status(200).json({
        handId,
        auditAvailable: false,
        verified: false,
        reason: 'rng metadata not provided',
        numberOfRuns,
        outcomes,
      });
    }

    // Construct minimal RNGSecurity payload for verification
    const rng: RNGSecurity = {
      seedGeneration: {
        entropy: Buffer.alloc(0),
        timestamp,
        playerEntropy,
        vrf: '',
      },
      verification: {
        publicSeed,
        hashChain,
        proof,
      },
    };

    const result = verifyRngSecurity(rng, numberOfRuns, playerEntropy);
    return res.status(200).json({
      handId,
      auditAvailable: true,
      verified: result.ok && JSON.stringify(result.computed) === JSON.stringify(hashChain),
      numberOfRuns,
      publicSeed,
      hashChain,
      proof,
      playerEntropy,
      timestamp,
      outcomes,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});

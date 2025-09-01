import crypto from 'crypto';

// Minimal VRF-like utilities using commit-reveal with a hash chain for per-board seeds
// Note: This is not a formal VRF; it provides verifiable determinism via revealing the secret.

export interface RNGSecuritySeedGeneration {
  entropy: Buffer;
  timestamp: number;
  playerEntropy: string;
  vrf: string; // HMAC(secret, 'rit-vrf') base64
}

export interface RNGSecurityVerification {
  publicSeed: string; // sha256(secret) hex
  hashChain: string[]; // per-board seeds as sha256(prev) chain starting from sha256(secret||playerEntropy||timestamp)
  proof: string; // secret hex revealed to verify publicSeed and chain
}

export interface RNGSecurity {
  seedGeneration: RNGSecuritySeedGeneration;
  verification: RNGSecurityVerification;
}

function sha256(buf: Buffer | string): Buffer {
  return crypto.createHash('sha256').update(buf).digest();
}

function hmacSha256(key: Buffer, message: string): Buffer {
  return crypto.createHmac('sha256', key).update(message).digest();
}

export function generateRngSecurity(numberOfRuns: number, playerEntropy = ''): { rng: RNGSecurity; seeds: string[] } {
  if (numberOfRuns < 1) throw new Error('numberOfRuns must be >= 1');
  const secret = crypto.randomBytes(32); // CSPRNG entropy (hardware-backed)
  const timestamp = Date.now();
  const seedMaterial = Buffer.concat([
    secret,
    Buffer.from(playerEntropy, 'utf8'),
    Buffer.from(String(timestamp), 'utf8'),
  ]);
  // initial = sha256(secret || playerEntropy || timestamp)
  let cur = sha256(seedMaterial);
  const chain: string[] = [];
  for (let i = 0; i < numberOfRuns; i++) {
    cur = sha256(cur);
    chain.push(cur.toString('hex'));
  }
  const publicSeed = sha256(secret).toString('hex');
  const vrf = hmacSha256(secret, 'rit-vrf').toString('base64');
  const rng: RNGSecurity = {
    seedGeneration: {
      entropy: secret,
      timestamp,
      playerEntropy,
      vrf,
    },
    verification: {
      publicSeed,
      hashChain: chain,
      proof: secret.toString('hex'),
    },
  };
  return { rng, seeds: chain.slice() };
}

export function verifyRngSecurity(rng: RNGSecurity, numberOfRuns: number, playerEntropy = ''): { ok: boolean; computed: string[] } {
  try {
    const secret = Buffer.from(rng.verification.proof, 'hex');
    const pub = sha256(secret).toString('hex');
    if (pub !== rng.verification.publicSeed) return { ok: false, computed: [] };
    const timestamp = rng.seedGeneration.timestamp;
    const seedMaterial = Buffer.concat([
      secret,
      Buffer.from(playerEntropy || rng.seedGeneration.playerEntropy || '', 'utf8'),
      Buffer.from(String(timestamp), 'utf8'),
    ]);
    let cur = sha256(seedMaterial);
    const chain: string[] = [];
    for (let i = 0; i < numberOfRuns; i++) {
      cur = sha256(cur);
      chain.push(cur.toString('hex'));
    }
    const ok = chain.length === numberOfRuns && JSON.stringify(chain) === JSON.stringify(rng.verification.hashChain);
    return { ok, computed: chain };
  } catch {
    return { ok: false, computed: [] };
  }
}

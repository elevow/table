import { RunItTwiceOutcomeInput } from '../../../types/game-history';
import { RunItTwiceRecorder } from '../run-it-twice-recorder';

// Mock pg Pool (no real DB connection in unit tests)
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({})) }));

// Prepare a mock service instance we can assert against
const mockService = {
  addRunItTwiceOutcome: jest.fn(),
};

// Mock HandHistoryService used by the recorder to inject our mock instance
jest.mock('../../services/hand-history-service', () => ({
  HandHistoryService: jest.fn().mockImplementation(() => mockService),
}));

describe('RunItTwiceRecorder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records an outcome via HandHistoryService', async () => {
    const { Pool } = require('pg');
    mockService.addRunItTwiceOutcome.mockResolvedValue({ id: 'o1' });

    const rec = new RunItTwiceRecorder(new Pool());
    const input: RunItTwiceOutcomeInput = {
      handId: 'h1',
      boardNumber: 1,
      communityCards: ['Ah', 'Kh', 'Qh', 'Jh', 'Th'],
      winners: [{ playerId: 'p1', potShare: 50 }],
      potAmount: 100,
    };

    await rec.record(input);
    expect(mockService.addRunItTwiceOutcome).toHaveBeenCalledTimes(1);
    expect(mockService.addRunItTwiceOutcome).toHaveBeenCalledWith(input);
  });

  it('propagates service errors', async () => {
    const { Pool } = require('pg');
    mockService.addRunItTwiceOutcome.mockRejectedValue(new Error('db down'));

    const rec = new RunItTwiceRecorder(new Pool());
    const input: RunItTwiceOutcomeInput = {
      handId: 'h2',
      boardNumber: 2,
      communityCards: ['2c', '2d', '2h', '2s', 'As'],
      winners: [{ playerId: 'p2', potShare: 75 }],
      potAmount: 150,
    };

    await expect(rec.record(input)).rejects.toThrow('db down');
    expect(mockService.addRunItTwiceOutcome).toHaveBeenCalledTimes(1);
  });
});

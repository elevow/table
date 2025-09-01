import { Pool } from 'pg';
import { HandHistoryService } from '../services/hand-history-service';
import { RunItTwiceOutcomeInput } from '../../types/game-history';

/**
 * RunItTwiceRecorder wires PokerEngine's RIT outcomes to the HandHistoryService.
 * Usage:
 *   const recorder = new RunItTwiceRecorder(pool);
 *   engine.configureRunItTwicePersistence(handId, (input) => recorder.record(input));
 */
export class RunItTwiceRecorder {
  private service: HandHistoryService;
  constructor(pool: Pool) {
    this.service = new HandHistoryService(pool);
  }

  async record(input: RunItTwiceOutcomeInput): Promise<void> {
    await this.service.addRunItTwiceOutcome(input);
  }
}

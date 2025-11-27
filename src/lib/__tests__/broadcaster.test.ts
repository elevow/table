import { NoopBroadcaster, createNoopBroadcaster, Broadcaster, BroadcasterRoom } from '../broadcaster';

describe('NoopBroadcaster', () => {
  let broadcaster: NoopBroadcaster;

  beforeEach(() => {
    broadcaster = new NoopBroadcaster();
  });

  describe('to()', () => {
    it('should return a BroadcasterRoom', () => {
      const room = broadcaster.to('test-room');
      expect(room).toBeDefined();
      expect(typeof room.emit).toBe('function');
    });

    it('should return the same noop room for any room name', () => {
      const room1 = broadcaster.to('room-1');
      const room2 = broadcaster.to('room-2');
      expect(room1).toBe(room2);
    });
  });

  describe('emit()', () => {
    it('should not throw when emitting events', () => {
      expect(() => broadcaster.emit('test-event')).not.toThrow();
    });

    it('should not throw when emitting events with arguments', () => {
      expect(() => broadcaster.emit('test-event', { data: 'test' }, 123)).not.toThrow();
    });
  });

  describe('BroadcasterRoom emit()', () => {
    it('should not throw when emitting events', () => {
      const room = broadcaster.to('test-room');
      expect(() => room.emit('test-event')).not.toThrow();
    });

    it('should not throw when emitting events with arguments', () => {
      const room = broadcaster.to('test-room');
      expect(() => room.emit('test-event', { data: 'test' }, 123)).not.toThrow();
    });
  });
});

describe('createNoopBroadcaster()', () => {
  it('should return a Broadcaster instance', () => {
    const broadcaster = createNoopBroadcaster();
    expect(broadcaster).toBeDefined();
    expect(typeof broadcaster.to).toBe('function');
    expect(typeof broadcaster.emit).toBe('function');
  });

  it('should return a NoopBroadcaster', () => {
    const broadcaster = createNoopBroadcaster();
    expect(broadcaster).toBeInstanceOf(NoopBroadcaster);
  });

  it('should create a new instance each time', () => {
    const broadcaster1 = createNoopBroadcaster();
    const broadcaster2 = createNoopBroadcaster();
    expect(broadcaster1).not.toBe(broadcaster2);
  });
});

describe('Broadcaster interface', () => {
  it('should be compatible with NoopBroadcaster', () => {
    const broadcaster: Broadcaster = new NoopBroadcaster();
    expect(broadcaster).toBeDefined();
  });

  it('should be compatible with createNoopBroadcaster result', () => {
    const broadcaster: Broadcaster = createNoopBroadcaster();
    expect(broadcaster).toBeDefined();
  });
});

describe('BroadcasterRoom interface', () => {
  it('should be compatible with room returned by NoopBroadcaster.to()', () => {
    const broadcaster = new NoopBroadcaster();
    const room: BroadcasterRoom = broadcaster.to('test-room');
    expect(room).toBeDefined();
  });
});

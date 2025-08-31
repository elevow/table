describe('ChatService (US-023)', () => {
  let ChatService: any;
  const mockMgr: any = {
    send: jest.fn(),
    listRoomMessages: jest.fn(),
    listPrivateMessages: jest.fn(),
    moderate: jest.fn(),
  };

  jest.mock('../../database/chat-manager', () => ({
    ChatManager: jest.fn().mockImplementation(() => mockMgr),
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => {
      // Import after mocks are registered
      ChatService = require('../../services/chat-service').ChatService;
    });
  });

  it('validates input on send and delegates', async () => {
    const svc = new ChatService({} as any);
    mockMgr.send.mockResolvedValue({ id: 'm1' });
    await expect(svc.send({ roomId: 'r1', senderId: 'u1', message: 'hi' })).resolves.toEqual({ id: 'm1' });
  });

  it('requires roomId for non-private', async () => {
    const svc = new ChatService({} as any);
    await expect(svc.send({ senderId: 'u1', message: 'x' } as any)).rejects.toThrow('roomId required');
  });

  it('requires recipientId for private', async () => {
    const svc = new ChatService({} as any);
    await expect(svc.send({ senderId: 'u1', message: 'x', isPrivate: true } as any)).rejects.toThrow('recipientId required');
  });

  it('lists room messages', async () => {
    const svc = new ChatService({} as any);
    mockMgr.listRoomMessages.mockResolvedValue([{ id: 'm1' }]);
    await expect(svc.listRoom({ roomId: 'r1' })).resolves.toEqual([{ id: 'm1' }]);
  });

  it('lists private messages', async () => {
    const svc = new ChatService({} as any);
    mockMgr.listPrivateMessages.mockResolvedValue([{ id: 'm2' }]);
    await expect(svc.listPrivate({ userAId: 'a', userBId: 'b' })).resolves.toEqual([{ id: 'm2' }]);
  });

  it('moderates a message', async () => {
    const svc = new ChatService({} as any);
    mockMgr.moderate.mockResolvedValue({ id: 'm3', isModerated: true });
    await expect(svc.moderate('m3', 'mod1', true)).resolves.toEqual({ id: 'm3', isModerated: true });
  });
});

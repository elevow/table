import { isMultipart, parseMultipart } from '../parse-multipart';

// Mock formidable which is dynamically required inside parseMultipart
jest.mock('formidable', () => {
  let impl: any = null;
  const mock = (options?: any) => {
    // Allow tests to swap implementation by setting impl
    if (impl) return impl(options);
    // Default implementation: succeed with simple fields/files
    return {
      parse: (_req: any, cb: Function) => {
        setTimeout(() => cb(null, { foo: 'bar' }, { file: { originalFilename: 'x.png' } }), 0);
      }
    };
  };
  (mock as any).__setImpl = (fn: any) => (impl = fn);
  return mock;
});

// Helper to access the mock control API
const getFormidableMock = () => require('formidable') as any;

describe('parse-multipart helpers', () => {
  afterEach(() => {
    // Reset mock implementation between tests
    getFormidableMock().__setImpl(null);
    jest.clearAllMocks();
  });

  it('isMultipart detects multipart content-type (case-insensitive)', () => {
    const req1: any = { headers: { 'content-type': 'multipart/form-data; boundary=abc' } };
    const req2: any = { headers: { 'content-type': 'Multipart/Form-Data; boundary=abc' } };
    const req3: any = { headers: { 'content-type': 'application/json' } };
    const req4: any = { headers: {} };
    expect(isMultipart(req1)).toBe(true);
    expect(isMultipart(req2)).toBe(true);
    expect(isMultipart(req3)).toBe(false);
    expect(isMultipart(req4)).toBe(false);
  });

  it('parseMultipart resolves with fields and files (success path)', async () => {
    const req: any = { headers: { 'content-type': 'multipart/form-data; boundary=abc' } };
    const result = await parseMultipart(req);
    expect(result.fields).toEqual({ foo: 'bar' });
    expect(result.files).toBeDefined();
    expect((result.files as any).file.originalFilename).toBe('x.png');
  });

  it('parseMultipart merges default options with overrides', async () => {
    const captured: any = { opts: null };
    getFormidableMock().__setImpl((opts: any) => {
      captured.opts = opts;
      return {
        parse: (_req: any, cb: Function) => cb(null, {}, {})
      };
    });
    const req: any = { headers: { 'content-type': 'multipart/form-data' } };
    await parseMultipart(req, { multiples: true });
    expect(captured.opts).toMatchObject({ keepExtensions: true, multiples: true });
  });

  it('parseMultipart rejects on parser error (error path)', async () => {
    getFormidableMock().__setImpl((_opts: any) => ({
      parse: (_req: any, cb: Function) => cb(new Error('boom'))
    }));
    const req: any = { headers: { 'content-type': 'multipart/form-data' } };
    await expect(parseMultipart(req)).rejects.toThrow('boom');
  });
});

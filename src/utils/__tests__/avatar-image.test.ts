import { fitWithin, uploadErrorMessage } from '../avatar-image';

describe('fitWithin', () => {
  it('scales the longest side down and keeps the shape', () => {
    expect(fitWithin(3000, 2000, 256)).toEqual({ width: 256, height: 171 });
    expect(fitWithin(2000, 3000, 256)).toEqual({ width: 171, height: 256 });
  });

  it('leaves small images alone', () => {
    expect(fitWithin(100, 80, 256)).toEqual({ width: 100, height: 80 });
  });

  it('never rounds a thin image down to nothing', () => {
    expect(fitWithin(5000, 1, 256)).toEqual({ width: 256, height: 1 });
  });
});

describe('uploadErrorMessage', () => {
  const reply = (status: number, body: string) => ({ status, text: async () => body });

  it('explains a body that is too large, which is plain text rather than JSON', async () => {
    await expect(uploadErrorMessage(reply(413, 'Body exceeded 1mb limit'))).resolves.toBe('That image is too large. Please choose a smaller one.');
  });

  it('passes on the error from the API', async () => {
    await expect(uploadErrorMessage(reply(429, JSON.stringify({ error: 'Upload limit exceeded. Try again later.' })))).resolves.toBe('Upload limit exceeded. Try again later.');
  });

  it('falls back when the reply is not JSON', async () => {
    await expect(uploadErrorMessage(reply(500, '<html>Server error</html>'))).resolves.toBe('Upload failed');
  });

  it('falls back when the reply has no error', async () => {
    await expect(uploadErrorMessage(reply(500, '{}'))).resolves.toBe('Upload failed');
  });
});

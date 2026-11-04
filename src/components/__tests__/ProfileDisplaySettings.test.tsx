import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProfileDisplaySettings from '../ProfileDisplaySettings';

let saved: Record<string, boolean>;
let failPut: boolean;
const fetchMock = jest.fn(async (_url: string, init?: any) => {
  if (init?.method === 'PUT') {
    if (failPut) return { ok: false, json: async () => ({}) };
    saved = { ...saved, ...JSON.parse(init.body).display };
  }
  return { ok: true, json: async () => ({ display: saved }) };
});

beforeEach(() => {
  saved = { highContrastCards: false, showPotOdds: true, showStackInBB: false };
  failPut = false;
  fetchMock.mockClear();
  (global as any).fetch = fetchMock;
});

test('shows the saved settings and saves each change', async () => {
  saved.showStackInBB = true;
  render(<ProfileDisplaySettings />);
  await waitFor(() => expect(screen.getByLabelText('Show stacks in big blinds')).toBeChecked());
  fireEvent.click(screen.getByLabelText('High-contrast cards'));
  expect(await screen.findByText('Saved')).toBeInTheDocument();
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(put[1].body)).toEqual({ display: { highContrastCards: true } });
  expect(screen.getByLabelText('High-contrast cards')).toBeChecked();
});

test('a failed save puts the checkbox back', async () => {
  failPut = true;
  render(<ProfileDisplaySettings />);
  await waitFor(() => expect(screen.getByLabelText('Show pot odds')).toBeEnabled());
  fireEvent.click(screen.getByLabelText('Show pot odds'));
  expect(await screen.findByText(/Couldn't save/)).toBeInTheDocument();
  expect(screen.getByLabelText('Show pot odds')).toBeChecked();
});

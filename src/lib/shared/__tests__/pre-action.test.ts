import { resolvePreAction } from '../pre-action';

describe('resolvePreAction', () => {
  it('check/fold checks when free and folds when facing a bet', () => {
    expect(resolvePreAction({ type: 'check-fold' }, 0)).toEqual({ action: 'check' });
    expect(resolvePreAction({ type: 'check-fold' }, 20)).toEqual({ action: 'fold' });
  });

  it('check is cancelled by a bet rather than folding', () => {
    expect(resolvePreAction({ type: 'check' }, 0)).toEqual({ action: 'check' });
    expect(resolvePreAction({ type: 'check' }, 20)).toEqual({ action: 'cancel' });
  });

  it('call X calls only that amount', () => {
    expect(resolvePreAction({ type: 'call', amount: 20 }, 20)).toEqual({ action: 'call', amount: 20 });
    expect(resolvePreAction({ type: 'call', amount: 20 }, 60)).toEqual({ action: 'cancel' });
    expect(resolvePreAction({ type: 'call', amount: 20 }, 0)).toEqual({ action: 'check' });
  });

  it('call any calls whatever is owed, or checks', () => {
    expect(resolvePreAction({ type: 'call-any' }, 60)).toEqual({ action: 'call', amount: 60 });
    expect(resolvePreAction({ type: 'call-any' }, 0)).toEqual({ action: 'check' });
  });
});

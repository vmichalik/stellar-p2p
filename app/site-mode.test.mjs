import test from 'node:test';
import assert from 'node:assert/strict';
import { demoEnabled, modeUrl } from './site-ui.mjs';
import { fundedDemoOffers } from './marketplace.mjs';
import { initialState, transition } from './model.mjs';

test('demo is opt-in, and switching modes preserves unrelated query parameters', () => {
  for (const query of ['', '?demo=0', '?demo=true', '?ref=demo'])
    assert.equal(demoEnabled('https://pactlane.io/' + query), false);
  assert.equal(demoEnabled('https://pactlane.io/?demo=1'), true);
  assert.equal(modeUrl('https://pactlane.io/?ref=friend#trade', true), '/?ref=friend&demo=1');
  assert.equal(modeUrl('https://pactlane.io/?ref=friend&demo=1#trade', false), '/?ref=friend');
});

test('market hides drafts and pending deposits, shows confirmed funding, removes reservations', () => {
  let state = initialState();
  const step = (event) => {
    state = transition(state, event);
  };
  assert.deepEqual(fundedDemoOffers(state), []);
  step({ type: 'seller_connect' });
  step({ type: 'seller_create', amount: '22', tag: '@ben' });
  assert.deepEqual(fundedDemoOffers(state), []);
  step({ type: 'seller_fund_started' });
  assert.deepEqual(fundedDemoOffers(state), []);
  step({ type: 'seller_fund_confirmed', id: 'PL-FUNDED', now: 500 });
  assert.equal(fundedDemoOffers(state).length, 1);
  assert.deepEqual(
    fundedDemoOffers({ ...state, seller: { ...state.seller, orderId: 'PL-OTHER' } }),
    [],
  );
  step({ type: 'connect' });
  step({ type: 'reserve', offerId: 'ben', amount: '20', id: 'PL-FUNDED', now: 1000 });
  assert.deepEqual(fundedDemoOffers(state), []);
});

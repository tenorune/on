// tests/cardDrawer.test.js
const { createCardDrawer, isCardDrawerOpen, closeCardDrawer } = require('../js/cardDrawer.js');

function makeAction(label) {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = `act-${label}`;
  return b;
}

beforeEach(() => {
  closeCardDrawer();           // reset singleton left open by a prior test
  document.body.innerHTML = '';
});

test('createCardDrawer returns an ellipsis toggle button', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  expect(ellipsis.tagName).toBe('BUTTON');
  expect(ellipsis.classList.contains('card-drawer-toggle')).toBe(true);
  expect(ellipsis.textContent).toBe('⋮');
});

test('clicking the ellipsis opens a drawer slice containing the actions', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  expect(isCardDrawerOpen()).toBe(false);
  ellipsis.click();
  const slice = document.querySelector('.card-drawer');
  expect(slice).not.toBeNull();
  expect(slice.querySelector('.act-a')).not.toBeNull();
  expect(slice.querySelector('.act-b')).not.toBeNull();
  expect(isCardDrawerOpen()).toBe(true);
});

test('clicking the ellipsis again closes the drawer', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  ellipsis.click();
  expect(document.querySelector('.card-drawer')).toBeNull();
  expect(isCardDrawerOpen()).toBe(false);
});

test('opening a second drawer closes the first (singleton)', () => {
  const e1 = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  const e2 = createCardDrawer([{ el: makeAction('c') }, { el: makeAction('d') }]);
  document.body.append(e1, e2);
  e1.click();
  e2.click();
  expect(document.querySelectorAll('.card-drawer').length).toBe(1);
  expect(document.querySelector('.card-drawer .act-c')).not.toBeNull();
});

test('a closesDrawer action closes the drawer, and only once across reopens', () => {
  const action = makeAction('x');
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: action, closesDrawer: true }]);
  document.body.appendChild(ellipsis);
  const closed = jest.fn();
  document.addEventListener('card-drawer-close', closed);

  ellipsis.click();                 // open
  action.dispatchEvent(new MouseEvent('click', { bubbles: true })); // closes
  expect(isCardDrawerOpen()).toBe(false);
  expect(closed).toHaveBeenCalledTimes(1);

  ellipsis.click();                 // reopen
  action.dispatchEvent(new MouseEvent('click', { bubbles: true })); // closes again
  expect(isCardDrawerOpen()).toBe(false);
  // One close per actual close — not 1 then 3 (which is what listener accumulation would produce)
  expect(closed).toHaveBeenCalledTimes(2);

  document.removeEventListener('card-drawer-close', closed);
});

test('open dispatches card-drawer-open, close dispatches card-drawer-close', () => {
  const opened = jest.fn();
  const closed = jest.fn();
  document.addEventListener('card-drawer-open', opened);
  document.addEventListener('card-drawer-close', closed);
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  expect(opened).toHaveBeenCalledTimes(1);
  ellipsis.click();
  expect(closed).toHaveBeenCalledTimes(1);
  document.removeEventListener('card-drawer-open', opened);
  document.removeEventListener('card-drawer-close', closed);
});

test('tapping outside the drawer closes it', () => {
  const outside = document.createElement('div');
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.append(ellipsis, outside);
  ellipsis.click();
  outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(isCardDrawerOpen()).toBe(false);
});

test('clicking inside the slice does NOT close the drawer', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  document.querySelector('.act-a').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(isCardDrawerOpen()).toBe(true);
});

test('Escape closes the drawer', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(isCardDrawerOpen()).toBe(false);
});

test('scrolling closes the drawer', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  document.dispatchEvent(new Event('scroll'));
  expect(isCardDrawerOpen()).toBe(false);
});

test('dismissal listeners are torn down after close (no lingering handlers)', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  document.dispatchEvent(new Event('scroll')); // closes
  const closedAgain = jest.fn();
  document.addEventListener('card-drawer-close', closedAgain);
  document.dispatchEvent(new Event('scroll')); // nothing open — must NOT fire close
  expect(closedAgain).not.toHaveBeenCalled();
  document.removeEventListener('card-drawer-close', closedAgain);
});

// Runs in every web page's top frame, in Electron's isolated world: page
// scripts cannot reach it. It does three things for saved passwords, and
// nothing else:
// - tells BulleBrowser whether the page has a sign-in form (for the key button);
// - when the person signs in, hands the username and password to BulleBrowser,
//   which offers to save them;
// - fills a saved login the person chose from BulleBrowser's own key button.
// BulleBrowser checks the page's site itself before saving or filling.

import { ipcRenderer } from 'electron';

const visible = (el: HTMLElement) => {
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};

const passwordFields = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter((el) => !el.disabled && visible(el));

/** The username field that belongs with a password field: the nearest text-like input before it. */
function usernameFieldFor(password: HTMLInputElement): HTMLInputElement | null {
  const scope = password.form ?? document;
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input'));
  const before = inputs.slice(0, inputs.indexOf(password)).reverse();
  return before.find((el) => /^(?:text|email|tel|)$/.test(el.type) && !el.disabled && visible(el))
    ?? inputs.find((el) => el.autocomplete === 'username' && visible(el))
    ?? null;
}

let reported: boolean | null = null;
function reportForm(): void {
  const present = passwordFields().length > 0;
  if (present === reported) return;
  reported = present;
  ipcRenderer.send('password:form', present);
}

let lastSent = '';
function captureSignIn(from?: EventTarget | null): void {
  const scope = from instanceof HTMLElement ? (from.closest('form') ?? document) : document;
  const filled = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter((el) => el.value);
  // On a sign-up or change-password form the last field holds the new password.
  const password = filled.at(-1);
  if (!password) return;
  const username = usernameFieldFor(password)?.value.trim() ?? '';
  const key = `${username}\u0000${password.value}`;
  if (key === lastSent) return;
  lastSent = key;
  ipcRenderer.send('password:submitted', { username: username.slice(0, 256), password: password.value.slice(0, 1024) });
}

function setValue(el: HTMLInputElement, value: string): void {
  // The native setter, so frameworks that track input values see the change.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

ipcRenderer.on('password:fill', (_event, login: { username: string; password: string }) => {
  const password = passwordFields()[0];
  if (!password) return;
  const username = usernameFieldFor(password);
  if (username && login.username) setValue(username, login.username);
  setValue(password, login.password);
  password.focus();
});

document.addEventListener('submit', (event) => captureSignIn(event.target), true);
// A click signs in when it is the form's submit button, or reads like one
// ("Show password" and other buttons do not).
const SIGN_IN = /\b(?:sign|log)\s*-?\s*(?:in|on)\b|\bcontinue\b|\bnext\b|\bsubmit\b|\bsign up\b|\bregister\b|\bsave\b/i;
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, input[type="submit"], [role="button"]') : null;
  if (!target) return;
  const submits = (target instanceof HTMLButtonElement && target.type === 'submit' && !!target.form)
    || (target instanceof HTMLInputElement && target.type === 'submit');
  const label = target instanceof HTMLInputElement ? target.value : target.textContent ?? '';
  if (submits || SIGN_IN.test(label) || SIGN_IN.test(target.getAttribute('aria-label') ?? '')) captureSignIn(target);
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) captureSignIn(event.target);
}, true);

let pending = 0;
const observer = new MutationObserver(() => {
  if (pending) return;
  pending = window.setTimeout(() => { pending = 0; reportForm(); }, 300);
});
window.addEventListener('DOMContentLoaded', () => {
  reportForm();
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'style', 'class', 'hidden'] });
});

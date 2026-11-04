import { test } from 'node:test';
import assert from 'node:assert/strict';
import { misleadingPrivacyClaim } from './check-privacy-claims.mjs';
test('rejects absolute privacy and shipped local-reasoning claims', () => {
  for (const text of ['Replies are generated on\nyour device.', 'Data never leaves your machine.', 'Reasoning runs entirely locally.', 'Local-first execution and summarization by default.', 'BulleBrowser integrates a high-performance LLM directly into user local hardware.']) assert.equal(misleadingPrivacyClaim(text), true, text);
});
test('allows accurate storage, speech, rule-based and provider disclosures', () => {
  for (const text of ['Speech audio is synthesized on your device; model-generated reply text uses your connected cloud provider.', 'Speech recognition runs locally.', 'Keys are stored on this device.', 'Model reasoning uses Anthropic or OpenAI.', 'The keyless command engine is rule-based, not a local reasoning model.', 'Local model adapters are planned, not shipped.']) assert.equal(misleadingPrivacyClaim(text), false, text);
});

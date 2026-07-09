import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SETTINGS_DOC = 'docs/SETTINGS.md';
const README_DOC = 'README.md';
const DOCS_INDEX = 'docs/README.md';
const WEBVIEW_DOC = 'docs/WEBVIEW.md';

async function readProjectFile(path) {
  return readFile(path, 'utf8');
}

const requiredSettingsConcepts = [
  {
    name: 'fresh-reader audience and action',
    pattern: /reader:\s*internal contributors[\s\S]*post-read action:\s*add a new setting/i,
  },
  {
    name: 'VS Code contributed configuration backs at least one real settings group',
    pattern: /at least one real settings group[\s\S]*VS Code contributed configuration/i,
  },
  {
    name: 'extension host owns reads and writes',
    pattern: /extension host owns[\s\S]*(reads|read)[\s\S]*(writes|write)/i,
  },
  {
    name: 'webview messages are typed and runtime-guarded',
    pattern: /typed[\s\S]*runtime-guarded/i,
  },
  {
    name: 'invalid updates fail closed with sanitized feedback',
    pattern: /fail closed[\s\S]*sanitized feedback/i,
  },
  {
    name: 'unit and protocol coverage pairs with Playwright harness',
    pattern: /unit[\s\S]*protocol[\s\S]*Playwright/i,
  },
  {
    name: 'R008 requirement reference',
    pattern: /\bR008\b/,
  },
  {
    name: 'local documentation verifier command',
    pattern: /node --test scripts\/verify-settings-docs\.test\.mjs/,
  },
  {
    name: 'focused Playwright settings harness command',
    pattern: /npx playwright test e2e\/muster-webview-state\.spec\.ts/,
  },
];

const requiredHeadings = [
  '# Settings pattern',
  '## Reader and action',
  '## Non-negotiable invariants',
  '## How to add a setting',
  '## Settings addition checklist',
  '## Failure behavior',
  '## Verification',
];

const unsupportedClaimPatterns = [
  {
    name: 'live VS Code Extension Development Host proof',
    pattern: /(?:verified|proven|tested|confirmed|validated)\s+(?:in|inside|with|against)\s+(?:a\s+)?(?:live\s+)?VS Code Extension Development Host/i,
  },
  {
    name: 'hosted CI proof',
    pattern: /(?:verified|proven|tested|confirmed|validated)\s+(?:in|by|on|with)\s+(?:hosted\s+)?CI/i,
  },
  {
    name: 'secret handling proof',
    pattern: /(?:secret|token|credential|API key)s?\s+(?:are|is)\s+(?:stored|managed|validated|verified|handled)/i,
  },
  {
    name: 'runtime session persistence proof',
    pattern: /(?:runtime|live)\s+session\s+(?:persistence|retention|restore|recovery)\s+(?:is|was|has been)\s+(?:verified|proven|tested|confirmed|validated)/i,
  },
];

function missingRequiredConcepts(markdown) {
  return requiredSettingsConcepts
    .filter(({ pattern }) => !pattern.test(markdown))
    .map(({ name }) => name);
}

function unsupportedClaims(markdown) {
  return unsupportedClaimPatterns
    .filter(({ pattern }) => pattern.test(markdown))
    .map(({ name }) => name);
}

function assertSettingsContract(markdown) {
  assert.ok(markdown.trim().length > 800, 'docs/SETTINGS.md should be a substantive fresh-reader guide');

  const missingHeadings = requiredHeadings.filter((heading) => !markdown.includes(heading));
  assert.deepEqual(missingHeadings, [], `docs/SETTINGS.md is missing headings: ${missingHeadings.join(', ')}`);

  const missingConcepts = missingRequiredConcepts(markdown);
  assert.deepEqual(missingConcepts, [], `docs/SETTINGS.md is missing concepts: ${missingConcepts.join(', ')}`);

  const forbiddenClaims = unsupportedClaims(markdown);
  assert.deepEqual(forbiddenClaims, [], `docs/SETTINGS.md contains unsupported claims: ${forbiddenClaims.join(', ')}`);

  assert.equal(/\.gsd\//.test(markdown), false, 'docs/SETTINGS.md should not depend on .gsd paths');
}

describe('Settings documentation contract', () => {
  it('keeps the host-backed settings guide substantive, local, and bounded', async () => {
    const markdown = await readProjectFile(SETTINGS_DOC);
    assertSettingsContract(markdown);
  });

  it('links the guide from contributor entry points', async () => {
    const [readme, docsIndex, webview] = await Promise.all([
      readProjectFile(README_DOC),
      readProjectFile(DOCS_INDEX),
      readProjectFile(WEBVIEW_DOC),
    ]);

    assert.match(readme, /docs\/SETTINGS\.md/, 'README.md should link docs/SETTINGS.md');
    assert.match(docsIndex, /\[`?SETTINGS\.md`?\]\(SETTINGS\.md\)/, 'docs/README.md should link SETTINGS.md');
    assert.match(webview, /\[`?SETTINGS\.md`?\]\(SETTINGS\.md\)/, 'docs/WEBVIEW.md related docs should link SETTINGS.md');
  });

  it('rejects fixture docs that omit required host-backed concepts', () => {
    const incompleteGuide = `# Settings pattern\n\n## Reader and action\nReader: internal contributors. Post-read action: add a new setting.\n\n## Verification\nRun node --test scripts/verify-settings-docs.test.mjs.`;

    const missingConcepts = missingRequiredConcepts(incompleteGuide);
    assert.ok(missingConcepts.includes('extension host owns reads and writes'));
    assert.ok(missingConcepts.includes('invalid updates fail closed with sanitized feedback'));
    assert.ok(missingConcepts.includes('unit and protocol coverage pairs with Playwright harness'));
  });

  it('rejects fixture docs that overclaim unsupported runtime, hosted CI, secret, or session proof', () => {
    const overclaimingGuide = `# Settings pattern\n\nThis was verified in a live VS Code Extension Development Host.\nThe settings were validated by hosted CI.\nSecrets are handled by this surface.\nRuntime session persistence has been verified.`;

    const claims = unsupportedClaims(overclaimingGuide);
    assert.deepEqual(claims, [
      'live VS Code Extension Development Host proof',
      'hosted CI proof',
      'secret handling proof',
      'runtime session persistence proof',
    ]);
  });
});

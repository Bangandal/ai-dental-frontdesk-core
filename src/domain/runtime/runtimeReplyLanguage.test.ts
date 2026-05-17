import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolveRuntimeReplyLanguage } from './runtimeReplyLanguage.js';
import type { RuntimeClinicRecord } from './runtimeTurnService.js';

const clinic: RuntimeClinicRecord = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'clinic_1',
  name: 'Clinic',
  timezone: 'Europe/Prague',
  settings: {},
};

describe('RuntimeReplyLanguage', () => {
  it('uses meta.language_code before clinic default_language and never needs raw text', () => {
    expect(resolveRuntimeReplyLanguage({ meta: { language_code: 'ru' }, clinic: { ...clinic, settings: { default_language: 'uk' } } })).toBe('ru');
    expect(resolveRuntimeReplyLanguage({ meta: { language_code: 'cs-CZ' }, clinic })).toBe('cs');
    expect(resolveRuntimeReplyLanguage({ meta: undefined, clinic: { ...clinic, settings: { default_language: 'en' } } })).toBe('en');
    expect(resolveRuntimeReplyLanguage({ meta: { language_code: 'unsupported' }, clinic })).toBe('uk');
  });

  it('does not use raw user text or semantic phrase matching for language selection', () => {
    const source = readFileSync(new URL('./runtimeReplyLanguage.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('user_text');
    expect(source).not.toContain('input.text');
    expect(source).not.toContain('regex');
  });
});

import { describe, expect, it } from 'vitest';
import { validateSignup } from '../src/auth';

describe('signup validation', () => {
  it('accepts a valid requester signup', () => {
    expect(validateSignup({name:'Alex Morgan',password:'dispatch-safe',confirmation:'dispatch-safe'})).toBe('');
  });

  it('requires a useful name and password', () => {
    expect(validateSignup({name:'A',password:'short',confirmation:'short'})).toBe('Enter your full name.');
    expect(validateSignup({name:'Alex Morgan',password:'short',confirmation:'short'})).toBe('Use a password with at least 8 characters.');
  });

  it('rejects mismatched passwords', () => {
    expect(validateSignup({name:'Alex Morgan',password:'dispatch-safe',confirmation:'dispatch-safer'})).toBe('Passwords do not match.');
  });
});

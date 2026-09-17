import { describe, it, expect } from 'vitest';
import { 
  getDocumentPrefix, 
  resolveOperationalCountryCode, 
  formatBusinessDocumentNumber, 
  validateDisplayNumber 
} from './businessDocumentNumberService';

describe('Business Document Number Service — Core Functions', () => {
  it('1. Correctly resolves document prefixes for all approved types', () => {
    expect(getDocumentPrefix('PHARMACY_VISIT')).toBe('PV');
    expect(getDocumentPrefix('PHYSICIAN_VISIT')).toBe('MV');
    expect(getDocumentPrefix('SALES_ORDER')).toBe('SO');
    expect(getDocumentPrefix('STOCK_REQUEST')).toBe('SR');
    expect(getDocumentPrefix('SAMPLE_REQUEST')).toBe('SM');
    expect(getDocumentPrefix('MARKETING_REQUEST')).toBe('MR');
    expect(getDocumentPrefix('COLLECTION_RECEIPT')).toBe('RC');
    expect(getDocumentPrefix('PURCHASE_ORDER')).toBe('PO');
    expect(getDocumentPrefix('GOODS_RECEIPT')).toBe('GR');
    expect(getDocumentPrefix('GOODS_ISSUE')).toBe('GI');
  });

  it('2. Correctly resolves operational country codes', () => {
    expect(resolveOperationalCountryCode('Libya')).toBe('LY');
    expect(resolveOperationalCountryCode('LY')).toBe('LY');
    expect(resolveOperationalCountryCode('C-LIB')).toBe('LY');
    expect(resolveOperationalCountryCode('Libya / West / Tripoli')).toBe('LY');

    expect(resolveOperationalCountryCode('Jordan')).toBe('JO');
    expect(resolveOperationalCountryCode('JO')).toBe('JO');
    expect(resolveOperationalCountryCode('C-JOR')).toBe('JO');

    expect(resolveOperationalCountryCode({ code: 'SA' })).toBe('SA');
    expect(resolveOperationalCountryCode({ countryId: 'C-EGY' })).toBe('EG');

    // Default fallback
    expect(resolveOperationalCountryCode(null)).toBe('LY');
    expect(resolveOperationalCountryCode(undefined)).toBe('LY');
  });

  it('3. Formats display numbers with 6-digit zero padding', () => {
    expect(formatBusinessDocumentNumber('LY', 'PV', 2026, 145)).toBe('LY-PV-2026-000145');
    expect(formatBusinessDocumentNumber('JO', 'SO', 2026, 18)).toBe('JO-SO-2026-000018');
    expect(formatBusinessDocumentNumber('LY', 'MV', 2026, 1)).toBe('LY-MV-2026-000001');
    expect(formatBusinessDocumentNumber('LY', 'SR', 2026, 999999)).toBe('LY-SR-2026-999999');
  });

  it('4. Validates business document number formats against spec regex', () => {
    expect(validateDisplayNumber('LY-PV-2026-000145')).toBe(true);
    expect(validateDisplayNumber('JO-SO-2026-000018')).toBe(true);
    expect(validateDisplayNumber('LY-MV-2026-000052')).toBe(true);
    expect(validateDisplayNumber('LY-SR-2026-000034')).toBe(true);

    // Invalid values
    expect(validateDisplayNumber('ly-pv-2026-000145')).toBe(false); // Lowercase
    expect(validateDisplayNumber('PV2_cQt7jjLOaHPgBmGCWzdjZm3pojo2')).toBe(false); // Firestore ID
    expect(validateDisplayNumber('LY-PV-26-145')).toBe(false); // Invalid year/seq
    expect(validateDisplayNumber(null)).toBe(false);
    expect(validateDisplayNumber(12345)).toBe(false);
  });
});

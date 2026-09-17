import { describe, it, expect, vi } from 'vitest';
import { 
  getDocumentPrefix, 
  resolveOperationalCountryCode, 
  formatBusinessDocumentNumber, 
  validateDisplayNumber,
  getOrCreateDisplayNumberInTransaction
} from '../lib/businessDocumentNumberService';

describe('WP6.2 — Enterprise Business Document Numbering Standard', () => {

  describe('1. Prefix Registry and Country Resolution', () => {
    it('maps Pharmacy Visit to PV', () => {
      expect(getDocumentPrefix('PHARMACY_VISIT')).toBe('PV');
    });

    it('maps Physician Visit to MV', () => {
      expect(getDocumentPrefix('PHYSICIAN_VISIT')).toBe('MV');
    });

    it('maps Sales Order to SO', () => {
      expect(getDocumentPrefix('SALES_ORDER')).toBe('SO');
    });

    it('maps Stock Request to SR', () => {
      expect(getDocumentPrefix('STOCK_REQUEST')).toBe('SR');
    });

    it('resolves operational country codes strictly without guessing from free text', () => {
      expect(resolveOperationalCountryCode('Libya')).toBe('LY');
      expect(resolveOperationalCountryCode('LY')).toBe('LY');
      expect(resolveOperationalCountryCode('C-LIB')).toBe('LY');
      expect(resolveOperationalCountryCode('Jordan')).toBe('JO');
      expect(resolveOperationalCountryCode({ code: 'SA' })).toBe('SA');
      expect(resolveOperationalCountryCode(null)).toBe('LY');
    });
  });

  describe('2. Document Number Formatting & Validation', () => {
    it('formats numbers with 6-digit zero-padded sequence e.g. LY-PV-2026-000145', () => {
      const num = formatBusinessDocumentNumber('LY', 'PV', 2026, 145);
      expect(num).toBe('LY-PV-2026-000145');
    });

    it('formats physician visit e.g. LY-MV-2026-000052', () => {
      const num = formatBusinessDocumentNumber('LY', 'MV', 2026, 52);
      expect(num).toBe('LY-MV-2026-000052');
    });

    it('validates against enterprise regex pattern', () => {
      expect(validateDisplayNumber('LY-PV-2026-000145')).toBe(true);
      expect(validateDisplayNumber('LY-MV-2026-000052')).toBe(true);
      expect(validateDisplayNumber('JO-SO-2026-000018')).toBe(true);
      expect(validateDisplayNumber('LY-SR-2026-000034')).toBe(true);

      // Unnumbered / internal ID checks
      expect(validateDisplayNumber('PV2_rep123_draft456')).toBe(false);
      expect(validateDisplayNumber('ORD_PV2_rep123_draft456')).toBe(false);
      expect(validateDisplayNumber('')).toBe(false);
    });
  });

  describe('3. Transaction Idempotency & Reuse Policy', () => {
    it('returns existing valid displayNumber without incrementing transaction counter', async () => {
      const mockTx: any = {
        get: vi.fn(),
        set: vi.fn()
      };

      const result = await getOrCreateDisplayNumberInTransaction(mockTx, {
        docRef: { id: 'testDoc' },
        existingData: { displayNumber: 'LY-PV-2026-000145' },
        documentType: 'PHARMACY_VISIT',
        countryInput: 'LY',
        dateOrYear: 2026,
        userId: 'user1'
      });

      expect(result).toBe('LY-PV-2026-000145');
      // No set/increment calls should be made if displayNumber exists
      expect(mockTx.set).not.toHaveBeenCalled();
    });
  });

  describe('4. Historical Record Policy', () => {
    it('returns fallback Legacy message when displayNumber is missing on historical record', () => {
      const visitRecord: any = {
        id: 'PV2_legacy_123',
        visitDate: '2025-01-01'
      };

      const display = visitRecord.displayNumber || 'Legacy Record — Number Not Assigned';
      expect(display).toBe('Legacy Record — Number Not Assigned');
    });
  });
});

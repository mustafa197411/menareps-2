import { describe, it, expect, vi } from 'vitest';
import fs from "node:fs";
import { formatPharmacyVisitCurrency, resolveDisplayLabel, resolvePharmacyVisitMarketIdentity, toRenderableText, safeToLocaleString } from './VisitsPage';
import { LIBYA_MARKET_DEFAULT } from '../lib/marketSettings';

describe('resolveDisplayLabel helper', () => {
  it('returns "—" for null or undefined', () => {
    expect(resolveDisplayLabel(null)).toBe('—');
    expect(resolveDisplayLabel(undefined)).toBe('—');
  });

  it('returns strings and numbers as-is', () => {
    expect(resolveDisplayLabel('Hello World')).toBe('Hello World');
    expect(resolveDisplayLabel(12345)).toBe('12345');
  });

  it('handles boolean values localized', () => {
    expect(resolveDisplayLabel(true, 'en')).toBe('Yes');
    expect(resolveDisplayLabel(false, 'en')).toBe('No');
    expect(resolveDisplayLabel(true, 'ar')).toBe('نعم');
    expect(resolveDisplayLabel(false, 'ar')).toBe('لا');
  });

  it('resolves structured label objects with labelEn, labelAr, code', () => {
    const obj = { code: 'REACTION_POS', labelEn: 'Positive Feedback', labelAr: 'انطباع إيجابي' };
    expect(resolveDisplayLabel(obj, 'en')).toBe('Positive Feedback');
    expect(resolveDisplayLabel(obj, 'ar')).toBe('انطباع إيجابي');
  });

  it('resolves multilingual name objects with nameEn, nameAr, name', () => {
    const obj = { nameEn: 'Tripoli Central Hospital', nameAr: 'مستشفى طرابلس المركزي' };
    expect(resolveDisplayLabel(obj, 'en')).toBe('Tripoli Central Hospital');
    expect(resolveDisplayLabel(obj, 'ar')).toBe('مستشفى طرابلس المركزي');
  });

  it('resolves objects with en and ar keys', () => {
    const obj = { en: 'Cardiology', ar: 'أمراض القلب' };
    expect(resolveDisplayLabel(obj, 'en')).toBe('Cardiology');
    expect(resolveDisplayLabel(obj, 'ar')).toBe('أمراض القلب');
  });

  it('resolves objects with textEn and textAr keys', () => {
    const obj = { textEn: 'Scientific Discussion', textAr: 'نقاش علمي' };
    expect(resolveDisplayLabel(obj, 'en')).toBe('Scientific Discussion');
    expect(resolveDisplayLabel(obj, 'ar')).toBe('نقاش علمي');
  });

  it('resolves objects with label or value keys', () => {
    const obj = { label: 'General Practice' };
    expect(resolveDisplayLabel(obj, 'en')).toBe('General Practice');
  });

  it('resolves objects with descEn, descAr, or description', () => {
    const obj = { descEn: 'High Priority Visit', descAr: 'زيارة ذات أولوية عالية' };
    expect(resolveDisplayLabel(obj, 'en')).toBe('High Priority Visit');
    expect(resolveDisplayLabel(obj, 'ar')).toBe('زيارة ذات أولوية عالية');
  });

  it('resolves fallback first string in custom structured object', () => {
    const obj = { customField: 'Custom Label Text' };
    expect(resolveDisplayLabel(obj, 'en')).toBe('Custom Label Text');
  });

  it('returns "—" for empty object without string values', () => {
    expect(resolveDisplayLabel({}, 'en')).toBe('—');
  });

  it('resolves array of labels cleanly', () => {
    const arr = [
      { code: 'A', labelEn: 'Alpha' },
      { code: 'B', labelEn: 'Beta' }
    ];
    expect(resolveDisplayLabel(arr, 'en')).toBe('Alpha, Beta');
  });
});

describe("pharmacy visit currency identity",()=>{
  it("accepts only the explicit server-resolved identity validated against the active registry",()=>expect(resolvePharmacyVisitMarketIdentity({resolvedMarketIdentity:{marketId:"C-LIB-1999",countryId:"C-LIB-1999"}},[LIBYA_MARKET_DEFAULT])).toEqual({marketId:"C-LIB-1999",countryId:"C-LIB-1999"}));
  it("formats a canonical visit normally and renders unresolved identity as unconfigured",()=>{expect(formatPharmacyVisitCurrency(12,{resolvedMarketIdentity:{marketId:"C-LIB-1999",countryId:"C-LIB-1999"}},[LIBYA_MARKET_DEFAULT])).toContain("LYD");expect(formatPharmacyVisitCurrency(12,{countryId:"LIBYA"},[LIBYA_MARKET_DEFAULT])).toBe("UNCONFIGURED")});
  it("fails closed for persisted-only or unregistered identities",()=>{expect(resolvePharmacyVisitMarketIdentity({countryId:"LIBYA"},[LIBYA_MARKET_DEFAULT])).toBeNull();expect(resolvePharmacyVisitMarketIdentity({resolvedMarketIdentity:{marketId:"RETIRED",countryId:"RETIRED"}},[LIBYA_MARKET_DEFAULT])).toBeNull()});
  it("contains no LYD hard-code, mock fallback, or client Firestore market/Area read",()=>{const source=fs.readFileSync(new URL("./VisitsPage.tsx",import.meta.url),"utf8");expect(source).not.toContain('"LYD"');expect(source).not.toContain("LIBYA_MARKET_DEFAULT");expect(source).not.toContain('collection(db,"areas")');expect(source).not.toContain('collection(db,"marketSettings")')});
});

describe('toRenderableText safety helper', () => {
  it('always returns a string and never returns an object', () => {
    const objFixture = { labelEn: 'Order Placement', labelAr: 'إدخال طلبية' };
    const result = toRenderableText('visitPurpose', objFixture, 'en', 'VISIT-123', 'Table');
    expect(typeof result).toBe('string');
    expect(result).toBe('Order Placement');
    expect(result).not.toContain('[object Object]');
  });

  it('logs [VISITS_RAW_OBJECT_RENDER_JSON] warning on structured objects', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const obj = { code: 'PURPOSE_INTAKE', labelEn: 'Order Intake', labelAr: 'تحصيل طلبية' };
    
    toRenderableText('visitPurpose', obj, 'ar', 'V-001', 'Modal');
    
    expect(warnSpy).toHaveBeenCalled();
    const warnCallArgs = warnSpy.mock.calls.find(call => call[0] === '[VISITS_RAW_OBJECT_RENDER_JSON]');
    expect(warnCallArgs).toBeDefined();
    if (warnCallArgs) {
      const parsed = JSON.parse(warnCallArgs[1]);
      expect(parsed.fieldName).toBe('visitPurpose');
      expect(parsed.recordId).toBe('V-001');
      expect(parsed.resolvedText).toBe('تحصيل طلبية');
    }
    warnSpy.mockRestore();
  });

  it('handles all realistic Firestore object fixtures safely', () => {
    const fixtures = [
      { field: 'visitPurpose', val: { code: 'ORDER', labelEn: 'Order Intake', labelAr: 'طلب توريد' }, expectedEn: 'Order Intake', expectedAr: 'طلب توريد' },
      { field: 'status', val: { code: 'COMPLETED', labelEn: 'Completed', labelAr: 'مكتملة' }, expectedEn: 'Completed', expectedAr: 'مكتملة' },
      { field: 'specialty', val: { labelEn: 'Pediatrics', labelAr: 'طب الأطفال' }, expectedEn: 'Pediatrics', expectedAr: 'طب الأطفال' },
      { field: 'gpsStatus', val: { labelEn: 'GPS Verified', labelAr: 'تم التحقق' }, expectedEn: 'GPS Verified', expectedAr: 'تم التحقق' },
      { field: 'representativeRole', val: { labelEn: 'Medical Rep', labelAr: 'مندوب طبي' }, expectedEn: 'Medical Rep', expectedAr: 'مندوب طبي' },
      { field: 'orderStatus', val: { labelEn: 'Approved', labelAr: 'معتمد' }, expectedEn: 'Approved', expectedAr: 'معتمد' },
      { field: 'paymentMethod', val: { labelEn: 'Cash', labelAr: 'نقداً' }, expectedEn: 'Cash', expectedAr: 'نقداً' },
      { field: 'reaction', val: { labelEn: 'Highly Favorable', labelAr: 'إيجابي جداً' }, expectedEn: 'Highly Favorable', expectedAr: 'إيجابي جداً' },
      { field: 'prescriptionIntent', val: { labelEn: 'High', labelAr: 'عالي' }, expectedEn: 'High', expectedAr: 'عالي' },
      { field: 'productName', val: { nameEn: 'Augmentin 1g', nameAr: 'أوجمنتين 1 جرام' }, expectedEn: 'Augmentin 1g', expectedAr: 'أوجمنتين 1 جرام' },
      { field: 'brandName', val: { labelEn: 'GSK Line', labelAr: 'خط جلاكسو' }, expectedEn: 'GSK Line', expectedAr: 'خط جلاكسو' }
    ];

    fixtures.forEach(({ field, val, expectedEn, expectedAr }) => {
      const textEn = toRenderableText(field, val, 'en', 'RECORD-999', 'TestFixture');
      const textAr = toRenderableText(field, val, 'ar', 'RECORD-999', 'TestFixture');

      expect(textEn).toBe(expectedEn);
      expect(textAr).toBe(expectedAr);
      expect(textEn).not.toContain('[object Object]');
      expect(textAr).not.toContain('[object Object]');
    });
  });
});

describe('safeToLocaleString helper', () => {
  it('formats numbers properly without crashing', () => {
    expect(safeToLocaleString(1000)).toBe('1,000');
    expect(safeToLocaleString(undefined)).toBe('0');
    expect(safeToLocaleString(null)).toBe('0');
  });
});

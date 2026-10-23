/**
 * Google Ads Conversion Tracking Configuration
 * 
 * Tag ID format: "AW-XXXXXXXXXX"
 * Conversion send_to format: "AW-XXXXXXXXXX/LABEL"
 * 
 * Can be overridden via environment variables:
 *   PUBLIC_GADS_TAG_ID
 *   PUBLIC_GADS_CONVERSION_SEND_TO
 * Or directly set as constants here.
 * 
 * If they are still placeholders, nothing will be loaded and nothing will be fired.
 */

const getEnv = (key: string): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  const proc = typeof globalThis !== 'undefined'
    ? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    : undefined;
  if (proc?.env && proc.env[key]) {
    return proc.env[key]!;
  }
  return '';
};

export const GOOGLE_TAG_CONFIG = {
  adsTagId:
    getEnv('PUBLIC_GADS_TAG_ID') ||
    getEnv('GOOGLE_ADS_TAG_ID') ||
    'AW-18507413408',
  gaMeasurementId:
    getEnv('PUBLIC_GA_MEASUREMENT_ID') ||
    getEnv('GA_MEASUREMENT_ID') ||
    'G-KH2W2VE90M',
  conversionSendTo:
    getEnv('PUBLIC_GADS_CONVERSION_SEND_TO') ||
    getEnv('GOOGLE_ADS_CONVERSION_SEND_TO') ||
    'AW-18507413408/2LB4CJKnmJodEKDvgvlE',
};

// Backwards-compatible export
export const GOOGLE_ADS_CONFIG = {
  tagId: GOOGLE_TAG_CONFIG.adsTagId,
  conversionSendTo: GOOGLE_TAG_CONFIG.conversionSendTo,
  gaMeasurementId: GOOGLE_TAG_CONFIG.gaMeasurementId,
};

/**
 * Returns true if the Google Ads Tag ID is valid and not a placeholder.
 */
export function isGoogleTagConfigured(tagId = GOOGLE_TAG_CONFIG.adsTagId): boolean {
  if (!tagId) return false;
  return tagId.startsWith('AW-') && !tagId.includes('XXXXXXXXXX');
}

/**
 * Returns true if the Google Analytics 4 Measurement ID is valid and not a placeholder.
 */
export function isGaConfigured(gaId = GOOGLE_TAG_CONFIG.gaMeasurementId): boolean {
  if (!gaId) return false;
  return gaId.startsWith('G-') && !gaId.includes('XXXXXXXXXX');
}

/**
 * Returns true if either Google Ads or GA4 is configured.
 */
export function isAnyGoogleTagActive(): boolean {
  return isGoogleTagConfigured() || isGaConfigured();
}

/**
 * Backwards-compatible alias.
 */
export function isGoogleAdsConfigured(tagId = GOOGLE_TAG_CONFIG.adsTagId): boolean {
  return isGoogleTagConfigured(tagId);
}

/**
 * Returns true only if conversion send_to has a specific conversion action label.
 */
export function isConversionSendToConfigured(
  sendTo = GOOGLE_TAG_CONFIG.conversionSendTo
): boolean {
  if (!sendTo) return false;
  return (
    sendTo.startsWith('AW-') &&
    !sendTo.includes('XXXXXXXXXX') &&
    !sendTo.endsWith('/LABEL') &&
    sendTo.includes('/')
  );
}

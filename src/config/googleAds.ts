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
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return '';
};

export const GOOGLE_ADS_CONFIG = {
  tagId:
    getEnv('PUBLIC_GADS_TAG_ID') ||
    getEnv('GOOGLE_ADS_TAG_ID') ||
    'AW-18507413408',
  conversionSendTo:
    getEnv('PUBLIC_GADS_CONVERSION_SEND_TO') ||
    getEnv('GOOGLE_ADS_CONVERSION_SEND_TO') ||
    'AW-18507413408/LABEL',
};

/**
 * Returns true if the Google Tag ID is a valid configured tag (e.g. AW-18507413408).
 */
export function isGoogleTagConfigured(tagId = GOOGLE_ADS_CONFIG.tagId): boolean {
  if (!tagId) return false;
  return tagId.startsWith('AW-') && !tagId.includes('XXXXXXXXXX');
}

/**
 * Returns true if Google Ads tag is active so that the gtag.js script renders in <head>.
 */
export function isGoogleAdsConfigured(tagId = GOOGLE_ADS_CONFIG.tagId): boolean {
  return isGoogleTagConfigured(tagId);
}

/**
 * Returns true only if conversion send_to has a specific conversion action label.
 */
export function isConversionSendToConfigured(
  sendTo = GOOGLE_ADS_CONFIG.conversionSendTo
): boolean {
  if (!sendTo) return false;
  return (
    sendTo.startsWith('AW-') &&
    !sendTo.includes('XXXXXXXXXX') &&
    !sendTo.endsWith('/LABEL') &&
    sendTo.includes('/')
  );
}

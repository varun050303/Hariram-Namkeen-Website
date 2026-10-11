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
    'AW-XXXXXXXXXX',
  conversionSendTo:
    getEnv('PUBLIC_GADS_CONVERSION_SEND_TO') ||
    getEnv('GOOGLE_ADS_CONVERSION_SEND_TO') ||
    'AW-XXXXXXXXXX/LABEL',
};

/**
 * Returns true only if both tagId and conversionSendTo are valid non-placeholder values.
 */
export function isGoogleAdsConfigured(
  tagId = GOOGLE_ADS_CONFIG.tagId,
  sendTo = GOOGLE_ADS_CONFIG.conversionSendTo
): boolean {
  if (!tagId || !sendTo) return false;

  const isPlaceholderTag =
    tagId === 'AW-XXXXXXXXXX' ||
    tagId.includes('XXXXXXXXXX') ||
    !tagId.startsWith('AW-');

  const isPlaceholderSendTo =
    sendTo === 'AW-XXXXXXXXXX/LABEL' ||
    sendTo.includes('XXXXXXXXXX') ||
    sendTo.endsWith('/LABEL');

  return !isPlaceholderTag && !isPlaceholderSendTo;
}
